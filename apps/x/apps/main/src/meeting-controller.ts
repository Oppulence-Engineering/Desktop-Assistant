import * as path from "node:path";
import * as fs from "node:fs/promises";
import { app, BrowserWindow } from "electron";
import type {
  MeetingCalendarEvent,
  MeetingCaptureState,
  MeetingCaptureStatus,
  MeetingLevels,
  MeetingSessionSummary,
  MeetingTrackId,
  MeetingTranscriptionProgress,
} from "@x/shared/dist/meetings.js";
import {
  createSessionDir,
  listSessionSummaries,
  MeetingQueue,
  nativeProvenance,
  patchMeta,
  readMeta,
  recordingsRoot,
  writeMeetingNote,
} from "@x/core/dist/meetings/meetings.js";
import type { WhisperService } from "@x/core/dist/voice/whisper/index.js";
import { getTranscriptionConfig } from "@x/core/dist/voice/voice.js";
import { MeetingCaptureSidecar, ensureMicrophoneAccess } from "./meeting-capture.js";

/**
 * The one owner of a native capture session: spawns the sidecar, holds the live
 * session, and hands finished sessions to the transcription queue.
 *
 * State lives here rather than in the renderer so a recording survives the window
 * closing — which is the whole point of moving capture out of the page. The tray and
 * the Meetings view are both just views onto this.
 */

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
  private onStateChange?: () => void;

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
        onLevel: (peaks) =>
          broadcast<MeetingLevels>("meeting:captureLevel", {
            sessionId: path.basename(dir),
            peaks: peaks as MeetingLevels["peaks"],
          }),
        onStopped: ({ crashed }) => void this.onSidecarStopped(crashed),
      });

      this.sessionDir = dir;
      this.sessionStartedAt = new Date();
      this.calendarEvent = calendarEvent;
      this.setState("recording");
      return { started: true, sessionId: path.basename(dir), tracks, warnings };
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
    this.setState("stopping");
    await this.sidecar.stop();
    const queued = await this.finishSession(dir);
    return { stopped: true, sessionId: path.basename(dir), queued };
  }

  /** Best-effort finalize on app quit so the last write is not a truncated file. */
  stopForQuit(): void {
    if (this.state !== "recording") return;
    console.log("[meeting] finalizing capture for quit");
    this.sidecar.killForQuit();
  }

  async status(): Promise<MeetingCaptureStatus> {
    const queue = this.queue;
    return {
      state: this.state,
      engine: "native",
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
    const calendarEvent = () => this.calendarEvent;

    this.queue = new MeetingQueue(root, {
      transcriber: {
        transcribe: (pcm, opts) => this.deps.whisper().transcribe(pcm, opts),
      },
      engine: () => "whisper.cpp",
      // Read at job time, not construction time, so switching models in settings
      // applies to the next session without a restart.
      model: () => this.modelId,
      keepAudio: () => this.keepAudio,
      writeNote: async ({ dir, meta, transcript }) => {
        const sessionId = path.basename(dir);
        const systemAudioCaptured = meta.tracks.some(
          (track) => track.id === "system" && !track.silent,
        );
        const notePath = await writeMeetingNote({
          sessionId,
          meta,
          transcript,
          calendarEvent: calendarEvent(),
          provenance: nativeProvenance({ model: this.modelId, systemAudioCaptured }),
        });
        this.notePath = notePath;
        return notePath;
      },
      onProgress: (progress) => {
        this.lastProgress = progress;
        broadcast<MeetingTranscriptionProgress>("meeting:captureProgress", progress);
        this.onStateChange?.();
      },
    });
    return this.queue;
  }

  /** Cached from settings; refreshed whenever a session starts or a job runs. */
  private modelId = "base.en-q5_1";
  private keepAudio: "always" | "untilTranscribed" | "never" = "untilTranscribed";

  /** Pull the settings the queue reads lazily. Called at boot and after a config
   *  change so a job never blocks on async config mid-drain. */
  async refreshSettings(): Promise<void> {
    const config = await getTranscriptionConfig();
    this.modelId = config.whisper?.model ?? this.modelId;
    this.keepAudio = config.meetings?.keepAudio ?? this.keepAudio;
  }

  get transcriptionProgress(): MeetingTranscriptionProgress | null {
    return this.lastProgress;
  }

  private setState(state: MeetingCaptureState): void {
    this.state = state;
    this.onStateChange?.();
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
