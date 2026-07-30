import * as path from "node:path";
import * as fs from "node:fs/promises";
import { app, BrowserWindow } from "electron";
import type {
  MeetingCalendarEvent,
  MeetingCaptureState,
  MeetingCaptureStatus,
  MeetingKeepAudio,
  MeetingLevels,
  MeetingSessionSummary,
  MeetingTrackId,
  MeetingTranscriptionEngine,
  MeetingTranscriptionProgress,
} from "@x/shared/dist/meetings.js";
import {
  calendarEventFromMeta,
  createSessionDir,
  listSessionSummaries,
  MeetingQueue,
  nativeProvenance,
  patchMeta,
  readMeta,
  recordingsRoot,
  withTranscriberFallback,
  writeMeetingNote,
} from "@x/core/dist/meetings/meetings.js";
import type { MeetingTranscriber } from "@x/core/dist/meetings/meetings.js";
import type { WhisperService } from "@x/core/dist/voice/whisper/index.js";
import { getTranscriptionConfig } from "@x/core/dist/voice/voice.js";
import {
  MeetingCaptureSidecar,
  ensureMicrophoneAccess,
  nativeCaptureAvailable,
} from "./meeting-capture.js";
import {
  audiocapCodec,
  codecAvailable,
  createParakeetTranscriber,
  type ParakeetModel,
} from "./meeting-engines.js";

/**
 * The one owner of a native capture session: spawns the sidecar, holds the live
 * session, and hands finished sessions to the transcription queue.
 *
 * State lives here rather than in the renderer so a recording survives the window
 * closing — which is the whole point of moving capture out of the page. The tray and
 * the Meetings view are both just views onto this.
 */

/** Two minutes with every track below this peak stops the session, matching the
 *  renderer pipeline's silence auto-stop. Levels are 0…1. */
const SILENCE_AUTO_STOP_MS = 2 * 60 * 1000;
const SILENCE_PEAK_LEVEL = 0.005;
/** How often the watch wakes. Level events arrive ~5×/second, so re-arming a timer on
 *  each one would churn thousands of timers over a meeting; recording a timestamp and
 *  checking it occasionally costs one assignment per event instead. */
const SILENCE_CHECK_INTERVAL_MS = 15 * 1000;

function broadcast<T>(channel: string, payload: T): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents) win.webContents.send(channel, payload);
  }
}

export interface MeetingControllerDeps {
  /** Lazily resolved so constructing the controller never downloads a model. */
  whisper: () => WhisperService;
}

export class MeetingController {
  private readonly sidecar = new MeetingCaptureSidecar();
  private queue: MeetingQueue | null = null;
  private state: MeetingCaptureState = "idle";
  private sessionDir: string | null = null;
  private sessionStartedAt: Date | null = null;
  private notePath: string | undefined;
  private calendarEvent: MeetingCalendarEvent | undefined;
  private lastProgress: MeetingTranscriptionProgress | null = null;
  /** Auto-stop watch: a forgotten recording should not run for hours. */
  private silenceWatch: NodeJS.Timeout | null = null;
  private lastActivityAt = 0;
  private onStateChange?: () => void;
  /** sessionId → note path, so the placeholder and the final note are one file. */
  private readonly notePaths = new Map<string, string>();

  constructor(private readonly deps: MeetingControllerDeps) {}

  /** Called after the tray exists so it can re-render on every transition. */
  setStateListener(listener: () => void): void {
    this.onStateChange = listener;
  }

  get recording(): boolean {
    return this.state === "recording";
  }

  get elapsedSeconds(): number {
    if (!this.sessionStartedAt) return 0;
    return Math.floor((Date.now() - this.sessionStartedAt.getTime()) / 1000);
  }

  async root(): Promise<string> {
    const config = await getTranscriptionConfig();
    return recordingsRoot(config.meetings?.recordingsDir);
  }

  /**
   * Pick up sessions that finished but never transcribed — a quit or crash
   * mid-transcription costs a retry, not a meeting.
   */
  async resumePending(): Promise<number> {
    const queue = await this.ensureQueue();
    const resumed = await queue.resumePending();
    if (resumed.length > 0) {
      console.log(`[meeting] resuming ${resumed.length} untranscribed session(s)`);
    }
    return resumed.length;
  }

  async start(calendarEvent?: MeetingCalendarEvent): Promise<{
    started: boolean;
    sessionId?: string;
    notePath?: string;
    tracks: MeetingTrackId[];
    warnings: string[];
    error?: string;
  }> {
    if (this.state !== "idle") {
      return { started: false, tracks: [], warnings: [], error: "already recording" };
    }
    if (!(await ensureMicrophoneAccess())) {
      return {
        started: false,
        tracks: [],
        warnings: [],
        error: "microphone access denied — enable it in System Settings › Privacy & Security",
      };
    }

    this.setState("starting");
    const config = await getTranscriptionConfig();
    const root = recordingsRoot(config.meetings?.recordingsDir);

    let dir: string;
    try {
      dir = await createSessionDir(root);
    } catch (err) {
      this.setState("idle");
      return { started: false, tracks: [], warnings: [], error: (err as Error).message };
    }

    try {
      const { tracks, warnings } = await this.sidecar.start({
        dir,
        voiceProcessing: config.meetings?.micVoiceProcessing ?? false,
        onLevel: (peaks) => {
          // The renderer pipeline auto-stops after two minutes with no transcript; the
          // native path has no transcript stream to watch, so it watches levels. Without
          // this, walking away from a finished call records until the app quits.
          if (Object.values(peaks).some((peak) => (peak ?? 0) >= SILENCE_PEAK_LEVEL)) {
            this.lastActivityAt = Date.now();
          }
          broadcast<MeetingLevels>("meeting:captureLevel", {
            sessionId: path.basename(dir),
            peaks: peaks as MeetingLevels["peaks"],
          });
        },
        onStopped: ({ crashed }) => void this.onSidecarStopped(crashed),
      });

      this.sessionDir = dir;
      this.sessionStartedAt = new Date();
      this.calendarEvent = calendarEvent;
      this.startSilenceWatch();

      // Write the note now, empty, so there is something to open while the meeting
      // runs — and remember its path so the post-transcription write lands on the
      // same file rather than deriving a second one.
      const sessionId = path.basename(dir);
      try {
        this.notePath = await writeMeetingNote({
          sessionId,
          startedAt: this.sessionStartedAt.toISOString(),
          segments: [],
          calendarEvent,
          provenance: nativeProvenance({
            model: this.modelId,
            systemAudioCaptured: tracks.includes("system"),
          }),
        });
        this.notePaths.set(sessionId, this.notePath);
      } catch (err) {
        // A note we could not write is not a reason to abandon a recording — the
        // transcript still lands, and the queue writes the note again afterwards.
        console.warn(`[meeting] could not create the note up front: ${(err as Error).message}`);
      }

      this.setState("recording");
      return {
        started: true,
        sessionId,
        notePath: this.notePath,
        tracks,
        warnings,
      };
    } catch (err) {
      // Nothing was captured, so leave no empty session directory behind to confuse
      // the queue or the sessions list.
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      this.setState("idle");
      return { started: false, tracks: [], warnings: [], error: (err as Error).message };
    }
  }

  async stop(): Promise<{ stopped: boolean; sessionId?: string; queued: boolean }> {
    if (this.state !== "recording") return { stopped: false, queued: false };
    const dir = this.sessionDir!;
    this.stopSilenceWatch();
    this.setState("stopping");
    await this.sidecar.stop();
    const queued = await this.finishSession(dir);
    return { stopped: true, sessionId: path.basename(dir), queued };
  }

  private startSilenceWatch(): void {
    this.stopSilenceWatch();
    this.lastActivityAt = Date.now();
    this.silenceWatch = setInterval(() => {
      if (Date.now() - this.lastActivityAt < SILENCE_AUTO_STOP_MS) return;
      console.log(`[meeting] ${SILENCE_AUTO_STOP_MS / 60_000} minutes of silence — stopping`);
      void this.stop();
    }, SILENCE_CHECK_INTERVAL_MS);
  }

  private stopSilenceWatch(): void {
    if (!this.silenceWatch) return;
    clearInterval(this.silenceWatch);
    this.silenceWatch = null;
  }

  /** Best-effort finalize on app quit so the last write is not a truncated file. */
  stopForQuit(): void {
    if (this.state !== "recording") return;
    this.stopSilenceWatch();
    console.log("[meeting] finalizing capture for quit");
    this.sidecar.killForQuit();
  }

  async status(): Promise<MeetingCaptureStatus> {
    return this.statusSnapshot();
  }

  /** Synchronous so every state transition can broadcast it without an await. */
  private statusSnapshot(): MeetingCaptureStatus {
    const queue = this.queue;
    return {
      state: this.state,
      // Only ever "native" here — this controller *is* the native path. Reported rather
      // than hardcoded at the call site so a renderer-engine machine is not told its
      // idle session is native.
      engine: nativeCaptureAvailable() ? "native" : "renderer",
      sessionId: this.sessionDir ? path.basename(this.sessionDir) : undefined,
      startedAt: this.sessionStartedAt?.toISOString(),
      elapsedSeconds: this.elapsedSeconds,
      notePath: this.notePath,
      tracks: this.sidecar.tracks,
      warnings: this.sidecar.sessionWarnings,
      queueDepth: queue?.depth ?? 0,
      transcribingSessionId: queue?.transcribingSessionId,
    };
  }

  async listSessions(): Promise<MeetingSessionSummary[]> {
    return listSessionSummaries(await this.root());
  }

  async retranscribe(sessionId: string): Promise<{ queued: boolean; error?: string }> {
    const dir = path.join(await this.root(), sessionId);
    const meta = await readMeta(dir);
    if (!meta) return { queued: false, error: "session not found" };
    if (meta.audio_deleted_at) {
      // Honest failure rather than a job that silently produces an empty transcript.
      return { queued: false, error: "audio was deleted by your retention setting" };
    }
    const queue = await this.ensureQueue();
    await queue.retranscribe(dir);
    return { queued: true };
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const root = await this.root();
    const dir = path.join(root, sessionId);
    // Guard against a traversal in the id turning this into an arbitrary delete.
    if (path.dirname(path.resolve(dir)) !== path.resolve(root)) return false;
    if (this.sessionDir === dir) return false;
    await fs.rm(dir, { recursive: true, force: true });
    return true;
  }

  // MARK: -

  /** The sidecar exited on its own — a crash, or the OS tearing it down. */
  private async onSidecarStopped(crashed: boolean): Promise<void> {
    if (this.state !== "recording") return;
    this.stopSilenceWatch();
    const dir = this.sessionDir!;
    this.setState("stopping");
    const queued = await this.finishSession(dir);
    broadcast("meeting:captureEnded", { sessionId: path.basename(dir), crashed, queued });
  }

  /**
   * Record the host-side additions and hand the session to the queue. Returns
   * whether it was enqueued — a session with no `meta.json` (the sidecar died before
   * finalizing) is left on disk for `resumePending` rather than dropped.
   */
  private async finishSession(dir: string): Promise<boolean> {
    this.sessionDir = null;
    this.sessionStartedAt = null;
    this.setState("idle");

    const config = await getTranscriptionConfig();
    await patchMeta(dir, {
      app_version: app.getVersion(),
      ...(this.calendarEvent ? { calendar_event: JSON.stringify(this.calendarEvent) } : {}),
    });

    if (!config.meetings?.transcribeOnStop) return false;
    const meta = await readMeta(dir);
    if (!meta) {
      console.warn(`[meeting] ${path.basename(dir)} has no meta.json — leaving it for resume`);
      return false;
    }
    (await this.ensureQueue()).enqueue(dir);
    return true;
  }

  private async ensureQueue(): Promise<MeetingQueue> {
    if (this.queue) return this.queue;
    const root = await this.root();

    // Both engines satisfy the same seam, so everything downstream — chunk offsets,
    // the merge, retention, the note — is shared. Parakeet is resolved per job so a
    // settings change applies to the next session without a restart.
    this.queue = new MeetingQueue(root, {
      transcriber: {
        transcribe: (pcm, opts) => this.transcriber().transcribe(pcm, opts),
      },
      engine: () => (this.transcriptionEngine === "parakeet" ? "parakeet" : "whisper.cpp"),
      // Read at job time, not construction time, so switching models in settings
      // applies to the next session without a restart.
      model: () => this.modelId,
      keepAudio: () => this.keepAudio,
      // Absent when the sidecar did not ship: retention then keeps the plain WAV
      // rather than failing to compress it.
      codec: codecAvailable() && this.compressRetainedAudio ? audiocapCodec : undefined,
      writeNote: async ({ dir, meta, transcript }) => {
        const sessionId = path.basename(dir);
        const systemAudioCaptured = meta.tracks.some(
          (track) => track.id === "system" && !track.silent,
        );
        // Read the calendar event off the session, not off whatever is recording now
        // — a session resumed from a previous launch would otherwise be labelled with
        // an unrelated meeting.
        const notePath = await writeMeetingNote({
          sessionId,
          startedAt: meta.started,
          segments: transcript.segments,
          calendarEvent: calendarEventFromMeta(meta),
          provenance: nativeProvenance({ model: this.modelId, systemAudioCaptured }),
          notePath: this.notePaths.get(sessionId),
        });
        this.notePaths.set(sessionId, notePath);
        this.notePath = notePath;
        return notePath;
      },
      onProgress: (progress) => {
        this.lastProgress = progress;
        broadcast<MeetingTranscriptionProgress>("meeting:captureProgress", progress);
        // Queue depth is part of the status the tray renders, so a job starting or
        // finishing is also a state change.
        this.onStateChange?.();
        broadcast<MeetingCaptureStatus>("meeting:captureState", this.statusSnapshot());
      },
    });
    return this.queue;
  }

  /** Cached from settings; refreshed whenever a session starts or a job runs. */
  private modelId = "base.en-q5_1";
  // Shared types rather than hand-written unions: a local copy silently drifts when the
  // schema changes, which is how `never` outlived its removal here.
  private keepAudio: MeetingKeepAudio = "untilTranscribed";
  private transcriptionEngine: MeetingTranscriptionEngine = "whisper";
  private parakeetModel: ParakeetModel = "v3";
  private compressRetainedAudio = true;

  /**
   * The engine for the next job. Falls back to whisper when Parakeet is selected but
   * the sidecar is missing — a settings value should never mean "no transcript".
   */
  private transcriber(): MeetingTranscriber {
    const whisper: MeetingTranscriber = {
      transcribe: (pcm, opts) => this.deps.whisper().transcribe(pcm, opts),
    };
    if (this.transcriptionEngine !== "parakeet" || !codecAvailable()) return whisper;

    // Parakeet is the fast path, not the only path: it can return nothing at all for
    // audio that plainly has speech, which for a meeting means silently losing one
    // side. Whisper backs it up on any window that had signal.
    return withTranscriberFallback(
      createParakeetTranscriber({ model: this.parakeetModel }),
      whisper,
      { onFallback: (reason) => console.warn(`[meeting] ${reason}`) },
    );
  }

  /** Pull the settings the queue reads lazily. Called at boot and after a config
   *  change so a job never blocks on async config mid-drain. */
  async refreshSettings(): Promise<void> {
    const config = await getTranscriptionConfig();
    this.transcriptionEngine = config.meetings?.transcriptionEngine ?? this.transcriptionEngine;
    this.parakeetModel = config.meetings?.parakeetModel ?? this.parakeetModel;
    this.compressRetainedAudio =
      config.meetings?.compressRetainedAudio ?? this.compressRetainedAudio;
    this.modelId =
      this.transcriptionEngine === "parakeet"
        ? `parakeet-tdt-0.6b-${this.parakeetModel}-coreml`
        : (config.whisper?.model ?? this.modelId);
    this.keepAudio = config.meetings?.keepAudio ?? this.keepAudio;
  }

  get transcriptionProgress(): MeetingTranscriptionProgress | null {
    return this.lastProgress;
  }

  private setState(state: MeetingCaptureState): void {
    this.state = state;
    // Both the tray and any open window are views onto this one piece of state, so
    // every transition notifies both rather than either polling.
    this.onStateChange?.();
    broadcast<MeetingCaptureStatus>("meeting:captureState", this.statusSnapshot());
  }
}

let controller: MeetingController | null = null;

/** Singleton, constructed on first use with the app's whisper service. */
export function getMeetingController(deps: MeetingControllerDeps): MeetingController {
  controller ??= new MeetingController(deps);
  return controller;
}

export function peekMeetingController(): MeetingController | null {
  return controller;
}
