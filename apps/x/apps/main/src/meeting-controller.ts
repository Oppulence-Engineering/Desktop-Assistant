import * as path from "node:path";
import * as fs from "node:fs/promises";
import { app, BrowserWindow } from "electron";
import { syncMeetingIndicator } from "./meeting-indicator.js";
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
  MeetingTranscript,
  MeetingTranscriptSegment,
} from "@x/shared/dist/meetings.js";
import type { RelationshipLiveCue } from "@x/shared/dist/relationships.js";
import {
  calendarEventFromMeta,
  createSessionDir,
  deleteMeetingNote,
  listSessionSummaries,
  readTranscript,
  MeetingQueue,
  nativeProvenance,
  patchMeta,
  readMeta,
  publishMeetingTranscribed,
  recordingsRoot,
  summarizeMeetingNote,
  withTranscriberFallback,
  writeMeetingNote,
  resolveCounterparty,
  extractCommitments,
  confirmCommitment,
  readLedger,
  setCommitmentStatus,
  askMeeting,
} from "@x/core/dist/meetings/meetings.js";
import { MeetingLiveTranscriber } from "./meeting-live.js";
import type {
  CounterpartyResolution,
  KnownPerson,
  LedgerCommitment,
  ProposedCommitment,
} from "@x/core/dist/meetings/meetings.js";
import {
  readCommitmentProposals,
  removeCommitmentProposal,
  writeCommitmentProposals,
} from "@x/core/dist/meetings/commitment-store.js";
import { buildKnowledgeIndex } from "@x/core/dist/knowledge/knowledge_index.js";
import type { MeetingTranscriber } from "@x/core/dist/meetings/meetings.js";
import type { WhisperService } from "@x/core/dist/voice/whisper/index.js";
import { getTranscriptionConfig } from "@x/core/dist/voice/voice.js";
import { summarizeMeeting } from "@x/core/dist/knowledge/summarize_meeting.js";
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
import {
  enqueueRelationshipEvidence,
  flushRelationshipEvidence,
} from "@x/core/dist/relationships/evidence-outbox.js";
import {
  confirmedCommitmentObservation,
  commitmentStatusObservation,
  meetingTranscriptObservation,
} from "@x/core/dist/relationships/meeting-evidence.js";
import { getRelationship, listRelationships } from "@x/core/dist/relationships/client.js";

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
/** Long enough to collapse one meeting's reads into one vault scan, short enough that a
 *  renamed person is not mislabelled for the rest of the session. */
const PEOPLE_CACHE_MS = 60_000;

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
  /** Above zero while a standby session is holding audio in memory. */
  private standbySeconds = 0;
  /** The throwaway transcript produced while the meeting runs. Never written to the
   *  note — the post-session pass is the record. */
  private readonly live = new MeetingLiveTranscriber({
    transcriber: () => this.transcriber(),
    onSegments: (segments) => {
      this.liveSegments.push(...segments);
      const sessionId = this.sessionDir ? path.basename(this.sessionDir) : "";
      broadcast("meeting:liveSegments", { sessionId, segments });
    },
  });
  private liveSegments: MeetingTranscriptSegment[] = [];
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

  /** Holding audio in memory, writing nothing, ready to reach backwards. */
  get standingBy(): boolean {
    return this.state === "standby";
  }

  /**
   * Promote a standby session. Everything the buffer holds becomes the start of the
   * recording; `onRecording` moves the session's start time back to match.
   *
   * The note is written here rather than at standby time — a standby that is never
   * promoted must leave nothing behind, including a note.
   */
  async beginRecording(): Promise<{ started: boolean; error?: string }> {
    if (this.state !== "standby") return { started: false, error: "not standing by" };
    if (!this.sidecar.beginRecording()) {
      return { started: false, error: "the recorder did not accept the request" };
    }
    // The note and the live pass both start from `onRecording`, not here: this only
    // means the request was sent. A promote that fails on the far side must leave no
    // note, and there is no file for a live pass to read either.
    return { started: true };
  }

  /** Write the placeholder note for a session that has just begun recording. */
  private async writePlaceholderNote(dir: string): Promise<void> {
    const sessionId = path.basename(dir);
    if (this.notePaths.has(sessionId)) return;
    try {
      this.notePath = await writeMeetingNote({
        sessionId,
        startedAt: (this.sessionStartedAt ?? new Date()).toISOString(),
        segments: [],
        calendarEvent: this.calendarEvent,
        provenance: nativeProvenance({
          model: this.modelId,
          sessionId,
          systemAudioCaptured: this.sidecar.tracks.includes("system"),
        }),
      });
      this.notePaths.set(sessionId, this.notePath);
    } catch (err) {
      // A note we could not write is not a reason to abandon a recording — the
      // transcript still lands, and the queue writes the note again afterwards.
      console.warn(`[meeting] could not create the note up front: ${(err as Error).message}`);
    }
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

  async start(
    calendarEvent?: MeetingCalendarEvent,
    opts: { standby?: boolean } = {},
  ): Promise<{
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
    this.standbySeconds = opts.standby ? (config.meetings?.standbySeconds ?? 300) : 0;

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
        standbySeconds: this.standbySeconds,
        onRecording: (recoveredSeconds) => {
          // The session really did begin earlier than the click. Moving this back keeps
          // the note's timestamp, the elapsed clock and the transcript on one clock.
          if (this.sessionStartedAt) {
            this.sessionStartedAt = new Date(Date.now() - recoveredSeconds * 1000);
          }
          this.setState("recording");
          // Only now, once the sidecar has confirmed it is writing.
          void this.writePlaceholderNote(dir);
          void this.maybeStartLive(dir, this.sidecar.tracks);
        },
        onError: (code, message) => {
          console.error(`[meeting] sidecar error ${code}: ${message}`);
          // The sidecar records errors into its warning list, but that list only
          // reaches a window on the next state transition — and a promote that fails
          // produces no transition at all, so the user would click "Record" and see
          // nothing happen, forever.
          broadcast<MeetingCaptureStatus>("meeting:captureState", this.statusSnapshot());
        },
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
      // same file rather than deriving a second one. Skipped while standing by: a
      // standby that is never promoted leaves no session, so it must leave no note.
      // The promote path writes it from `onRecording` instead, once the sidecar has
      // confirmed it is actually writing.
      const sessionId = path.basename(dir);
      if (!this.standbySeconds) await this.writePlaceholderNote(dir);

      const liveIdentity = resolveCounterparty(calendarEvent).counterparty;
      this.liveCounterparty = liveIdentity?.label;
      this.liveCues = [];
      if (liveIdentity) void this.loadLiveCues(liveIdentity, sessionId);

      // Live transcription only once actually recording — there is no file to read
      // while standing by, which is the entire point of standing by.
      if (this.standbySeconds === 0 && config.meetings?.liveTranscript) {
        // Deliberately the *cheap* resolution here. This runs as recording starts, and
        // a whole-vault scan at that moment would stall the app exactly when the user is
        // watching it begin. The calendar's own display name is good enough for a live
        // panel; the note gets the canonical one afterwards.
        this.startLive(dir, tracks);
      }
      this.setState(this.standbySeconds > 0 ? "standby" : "recording");
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
      standbySeconds: this.state === "standby" ? this.standbySeconds : 0,
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

  async deleteSession(
    sessionId: string,
    deleteNote = false,
  ): Promise<{ deleted: boolean; noteDeleted: boolean }> {
    const root = await this.root();
    const dir = path.join(root, sessionId);
    // Guard against a traversal in the id turning this into an arbitrary delete.
    if (path.dirname(path.resolve(dir)) !== path.resolve(root)) {
      return { deleted: false, noteDeleted: false };
    }
    if (this.sessionDir === dir) return { deleted: false, noteDeleted: false };

    // Read the meta before removing the directory — it is what the note path is
    // derived from, and the caller never supplies one.
    const meta = deleteNote ? await readMeta(dir) : null;
    let noteDeleted = false;
    if (meta) {
      try {
        noteDeleted = await deleteMeetingNote(sessionId, meta);
      } catch (err) {
        // A note we could not remove is not a reason to keep the recording the user
        // asked to delete; report it rather than failing the whole operation.
        console.warn(`[meeting] could not delete the note for ${sessionId}:`, err);
      }
    }

    await fs.rm(dir, { recursive: true, force: true });
    this.notePaths.delete(sessionId);
    return { deleted: true, noteDeleted };
  }

  /**
   * Delete every recording. Built on `deleteSession` rather than an `rm -rf` of the
   * root so each session keeps the same protections — the traversal guard, the
   * in-progress guard, and notes going to the trash instead of being unlinked.
   *
   * A session that fails is counted and skipped rather than aborting the sweep: the
   * user asked for everything gone, and stopping halfway leaves them worse off than
   * either outcome.
   */
  async deleteAllSessions(
    deleteNotes = false,
  ): Promise<{ deleted: number; notesDeleted: number; failed: number }> {
    const sessions = await this.listSessions();
    let deleted = 0;
    let notesDeleted = 0;
    let failed = 0;
    for (const session of sessions) {
      try {
        const result = await this.deleteSession(session.id, deleteNotes);
        if (result.deleted) deleted++;
        else failed++;
        if (result.noteDeleted) notesDeleted++;
      } catch (err) {
        console.warn(`[meeting] could not delete ${session.id}:`, err);
        failed++;
      }
    }
    return { deleted, notesDeleted, failed };
  }

  /**
   * A finished session's transcript segments.
   *
   * `found: false` rather than an empty list for a session that has none: "nothing was
   * said" and "it has not transcribed yet" are different answers, and a caller that
   * cannot tell them apart will show the wrong one.
   */
  async sessionTranscript(
    sessionId: string,
  ): Promise<{ segments: MeetingTranscript["segments"]; found: boolean }> {
    const root = await this.root();
    const dir = path.join(root, sessionId);
    if (path.dirname(path.resolve(dir)) !== path.resolve(root)) {
      return { segments: [], found: false };
    }
    const transcript = await readTranscript(dir);
    return transcript
      ? { segments: transcript.segments, found: true }
      : { segments: [], found: false };
  }

  /**
   * Playable files for a session, as `app://recording/...` URLs.
   *
   * Retention deletes audio once a transcript exists unless the user opted to keep it,
   * so "there is nothing to play" is the common, correct case rather than a failure —
   * and it is reported with a reason so the UI can say which.
   */
  async audioTracks(sessionId: string): Promise<{
    tracks: { track: MeetingTrackId; url: string; offsetMs: number; durationMs: number }[];
    reason?: string;
  }> {
    const root = await this.root();
    const dir = path.join(root, sessionId);
    if (path.dirname(path.resolve(dir)) !== path.resolve(root)) {
      return { tracks: [], reason: "unknown recording" };
    }
    const meta = await readMeta(dir);
    if (!meta) return { tracks: [], reason: "this recording is no longer on disk" };
    if (meta.audio_deleted_at) {
      return { tracks: [], reason: "the audio was removed by your retention setting" };
    }

    const tracks: { track: MeetingTrackId; url: string; offsetMs: number; durationMs: number }[] =
      [];
    for (const track of meta.tracks) {
      // Retention may have compressed the file since meta was written, so the name in
      // meta is a starting point rather than the answer.
      const candidates = [track.file, track.file.replace(/\.wav$/, ".m4a")];
      for (const name of candidates) {
        try {
          await fs.access(path.join(dir, name));
          tracks.push({
            track: track.id,
            url: `app://recording/${encodeURIComponent(sessionId)}/${encodeURIComponent(name)}`,
            offsetMs: track.offset_ms,
            durationMs: track.duration_ms,
          });
          break;
        } catch {
          // Try the compressed name before giving up on this track.
        }
      }
    }
    return tracks.length > 0
      ? { tracks }
      : { tracks: [], reason: "the audio was removed by your retention setting" };
  }

  /**
   * Resolve a meeting's counterparty without paying for the knowledge index unless it
   * can possibly help.
   *
   * `buildKnowledgeIndex()` is fully synchronous and `readFileSync`s every note in the
   * vault. Calling it on the main process blocks IPC, the tray and every window event
   * for as long as it takes — and it was being called three times per meeting, one of
   * them at the instant recording starts, which is the worst moment in the app to
   * freeze.
   *
   * Two things fix that. The cheap resolution runs first with no index at all: it
   * already knows whether this is a 1:1, and on a group call — where the answer is
   * "decline" regardless — the index is never touched. When it is a 1:1 the index is
   * consulted for the canonical name, through a short-lived cache so the note write and
   * the commitment pass of the same meeting share one build.
   */
  private resolveMeetingCounterparty(
    calendarEvent: MeetingCalendarEvent | undefined,
  ): CounterpartyResolution {
    const cheap = resolveCounterparty(calendarEvent);
    // Not a 1:1, or nothing to name: no index can change this answer.
    if (!cheap.counterparty) return cheap;
    return resolveCounterparty(calendarEvent, { people: this.knownPeople() });
  }

  /**
   * People from the knowledge index, cached briefly.
   *
   * The TTL is short because a stale index would name someone by an old title; it exists
   * only so the two or three reads within one finished meeting collapse into one scan.
   */
  private peopleCache: { at: number; people: KnownPerson[] } | null = null;

  private knownPeople(): {
    name: string;
    email?: string;
    aliases?: string[];
    organization?: string;
    role?: string;
  }[] {
    const now = Date.now();
    if (this.peopleCache && now - this.peopleCache.at < PEOPLE_CACHE_MS) {
      return this.peopleCache.people;
    }
    try {
      const people = buildKnowledgeIndex().people;
      this.peopleCache = { at: now, people };
      return people;
    } catch {
      // A failure here just means the calendar's own display name is used.
      this.peopleCache = { at: now, people: [] };
      return [];
    }
  }

  /** Start the live pass if the user asked for one. */
  private async maybeStartLive(dir: string, tracks: MeetingTrackId[]): Promise<void> {
    const config = await getTranscriptionConfig();
    if (!config.meetings?.liveTranscript) return;
    this.startLive(dir, tracks);
  }

  /** Start the live pass, tolerating a failure — it is an aid, not the record. */
  private startLive(
    dir: string,
    tracks: MeetingTrackId[] | { id: string; speaker: string; file: string }[],
  ): void {
    this.liveSegments = [];
    const normalized = tracks.map((track) =>
      typeof track === "string"
        ? { id: track, speaker: track === "mic" ? "me" : "them", file: `${track}.wav` }
        : track,
    );
    try {
      this.live.start(dir, normalized);
    } catch (err) {
      console.warn("[meeting] could not start live transcription:", err);
    }
  }

  /** Display name for `them` in the live transcript, when the meeting is a named 1:1. */
  private liveCounterparty: string | undefined;
  private liveCues: RelationshipLiveCue[] = [];

  private async loadLiveCues(
    counterparty: { label: string; email?: string },
    sessionId: string,
  ): Promise<void> {
    try {
      const query = counterparty.email || counterparty.label;
      const { relationships } = await listRelationships({ q: query });
      const normalizedEmail = counterparty.email?.trim().toLowerCase();
      const match = relationships.find((relationship) =>
        normalizedEmail
          ? relationship.primaryEmail?.trim().toLowerCase() === normalizedEmail
          : relationship.displayName.trim().toLowerCase() ===
            counterparty.label.trim().toLowerCase(),
      );
      if (!match) return;
      const detail = await getRelationship(match.id);
      // Do not let a slow request from an ended meeting leak relationship context into
      // a later session. Session identity, not timing, decides whether the result is live.
      if (!this.sessionDir || path.basename(this.sessionDir) !== sessionId) return;
      this.liveCues = detail.intelligence?.liveCues ?? [];
      broadcast("meeting:liveCues", { cues: this.liveCues });
    } catch (err) {
      console.warn("[meeting] account-aware cue cards could not be loaded:", err);
    }
  }

  /** The in-progress transcript, in order. */
  liveTranscript(): {
    active: boolean;
    sessionId?: string;
    counterparty?: string;
    segments: MeetingTranscriptSegment[];
    cues: RelationshipLiveCue[];
  } {
    if (!this.live.active) return { active: false, segments: [], cues: this.liveCues };
    return {
      active: true,
      sessionId: this.sessionDir ? path.basename(this.sessionDir) : undefined,
      counterparty: this.liveCounterparty,
      // Ordered by their own track clocks. Offsets are unknown until the session ends,
      // so this is approximate — fine for reading, and the final pass fixes it.
      segments: [...this.liveSegments].sort((a, b) => a.start_ms - b.start_ms),
      cues: this.liveCues,
    };
  }

  /** Answer a question about the meeting in progress. */
  async ask(question: string): Promise<{ answer: string; error?: string }> {
    const live = this.liveTranscript();
    if (!live.active) {
      return { answer: "", error: "no meeting is being transcribed right now" };
    }
    try {
      const answer = await askMeeting({
        question,
        segments: live.segments,
        labels: { me: "You", them: live.counterparty ?? "Other" },
      });
      return { answer };
    } catch (err) {
      return { answer: "", error: (err as Error).message };
    }
  }

  /** Unconfirmed proposals for a session, with the name to show for `them`. */
  async commitments(
    sessionId: string,
  ): Promise<{ proposals: ProposedCommitment[]; counterparty?: string }> {
    const dir = await this.sessionPath(sessionId);
    if (!dir) return { proposals: [] };
    const stored = await readCommitmentProposals(dir);
    return { proposals: stored?.proposals ?? [], counterparty: stored?.counterparty };
  }

  /**
   * Unconfirmed proposals across recent sessions, newest first.
   *
   * Bounded to the most recent sessions rather than the whole history: a proposal from
   * three months ago that was never confirmed was, in effect, declined, and showing it
   * forever turns the list into something people stop reading.
   */
  async pendingCommitments(limit = 10): Promise<
    {
      sessionId: string;
      meetingTitle?: string;
      meetingStarted?: string;
      counterparty?: string;
      notePath?: string;
      proposals: ProposedCommitment[];
    }[]
  > {
    const sessions = (await this.listSessions()).slice(0, limit);
    const out = [];
    for (const session of sessions) {
      const stored = await readCommitmentProposals(session.dir);
      if (!stored || stored.proposals.length === 0) continue;
      out.push({
        sessionId: session.id,
        meetingTitle: stored.meetingTitle,
        meetingStarted: stored.meetingStarted ?? session.startedAt,
        counterparty: stored.counterparty,
        notePath: stored.notePath ?? session.notePath,
        proposals: stored.proposals,
      });
    }
    return out;
  }

  /**
   * Confirm one proposal into the ledger and drop it from the pending list.
   *
   * Identified by its span rather than by index: the pending list can change under a
   * window that has been open for a while, and confirming "the third one" would then
   * confirm the wrong commitment.
   */
  async confirmCommitment(
    sessionId: string,
    startMs: number,
    endMs: number,
  ): Promise<{ confirmed: boolean; id?: string }> {
    const dir = await this.sessionPath(sessionId);
    if (!dir) return { confirmed: false };
    const stored = await readCommitmentProposals(dir);
    const proposal = stored?.proposals.find(
      (item) => item.start_ms === startMs && item.end_ms === endMs,
    );
    if (!proposal) return { confirmed: false };

    const entry = await confirmCommitment({
      proposal,
      sessionId,
      notePath: stored?.notePath,
      meetingTitle: stored?.meetingTitle,
      meetingStarted: stored?.meetingStarted,
      counterpartyLabel: stored?.counterparty,
    });
    const settings = await getTranscriptionConfig();
    if (settings.meetings.syncRelationshipEvidence) {
      try {
        const meta = await readMeta(dir);
        if (meta) {
          const { counterparty } = this.resolveMeetingCounterparty(calendarEventFromMeta(meta));
          if (counterparty) {
            await enqueueRelationshipEvidence(
              confirmedCommitmentObservation({ commitment: entry, counterparty }),
            );
            void this.flushRelationshipEvidence();
          }
        }
      } catch (err) {
        // The local ledger is the first durable write. A relationship-sync problem
        // cannot turn a confirmed commitment back into a pending model proposal.
        console.warn("[meeting] could not queue confirmed relationship evidence:", err);
      }
    }
    await removeCommitmentProposal(dir, startMs, endMs);
    return { confirmed: true, id: entry.id };
  }

  /**
   * Compile the window-owned fallback transcript into the same shared evidence shape
   * as native capture. Renderer notes do not retain timed audio, so their segments use
   * zero spans and the payload says nothing stronger.
   */
  async publishRendererEvidence(args: {
    sessionId: string;
    startedAt: string;
    calendarEventJson?: string;
    provider: string;
    segments: { speaker: string; text: string }[];
  }): Promise<{ queued: boolean; reason?: string }> {
    const settings = await getTranscriptionConfig();
    if (!settings.meetings.syncRelationshipEvidence) {
      return { queued: false, reason: "relationship evidence sync is off" };
    }
    if (args.segments.length === 0) return { queued: false, reason: "transcript is empty" };

    let calendarEvent: MeetingCalendarEvent | undefined;
    if (args.calendarEventJson) {
      try {
        calendarEvent = JSON.parse(args.calendarEventJson) as MeetingCalendarEvent;
      } catch {
        return { queued: false, reason: "calendar event is invalid" };
      }
    }
    const { counterparty, reason } = this.resolveMeetingCounterparty(calendarEvent);
    if (!counterparty) return { queued: false, reason: reason ?? "counterparty is unresolved" };

    const ended = new Date().toISOString();
    const startedMs = new Date(args.startedAt).getTime();
    const endedMs = new Date(ended).getTime();
    const speakers = new Set(
      args.segments.map((segment) =>
        segment.speaker.trim().toLowerCase() === "you" ? "mic" : "system",
      ),
    );
    const meta = {
      schema: 1 as const,
      started: args.startedAt,
      ended,
      duration_seconds:
        Number.isFinite(startedMs) && Number.isFinite(endedMs)
          ? Math.max(0, (endedMs - startedMs) / 1000)
          : 0,
      audio: {
        sample_rate: 16_000,
        channels: 2,
        encoding: "pcm_s16le" as const,
        container: "wav" as const,
      },
      tracks: [...speakers].map((id) => ({
        id: id as MeetingTrackId,
        speaker: (id === "mic" ? "me" : "them") as "me" | "them",
        file: "not-retained",
        offset_ms: 0,
        frames: 0,
        duration_ms: 0,
        peak: 0,
        silent: false,
      })),
      warnings: ["renderer fallback: timed audio evidence was not retained"],
      ...(args.calendarEventJson ? { calendar_event: args.calendarEventJson } : {}),
    };
    const transcript = {
      schema: 1 as const,
      engine: args.provider === "whisper-local" ? "whisper.cpp" : args.provider,
      model: args.provider === "whisper-local" ? settings.whisper.model : "nova-3",
      created_at: ended,
      segments: args.segments
        .map((segment) => ({
          speaker:
            segment.speaker.trim().toLowerCase() === "you" ? ("me" as const) : ("them" as const),
          start_ms: 0,
          end_ms: 0,
          text: segment.text.trim(),
        }))
        .filter((segment) => segment.text.length > 0),
    };
    await enqueueRelationshipEvidence(
      meetingTranscriptObservation({
        sessionId: args.sessionId,
        meta,
        transcript,
        counterparty,
        settings: settings.meetings,
      }),
    );
    void this.flushRelationshipEvidence();
    return { queued: true };
  }

  async dismissCommitment(
    sessionId: string,
    startMs: number,
    endMs: number,
  ): Promise<{ dismissed: boolean }> {
    const dir = await this.sessionPath(sessionId);
    if (!dir) return { dismissed: false };
    return { dismissed: await removeCommitmentProposal(dir, startMs, endMs) };
  }

  async ledger(): Promise<LedgerCommitment[]> {
    // Newest first: the ledger is read to answer "what did I just agree to".
    return (await readLedger()).sort((a, b) => b.confirmed_at.localeCompare(a.confirmed_at));
  }

  async setCommitmentStatus(id: string, status: "open" | "done" | "dropped"): Promise<boolean> {
    const updated = await setCommitmentStatus(id, status);
    if (!updated) return false;
    try {
      const settings = await getTranscriptionConfig();
      if (!settings.meetings.syncRelationshipEvidence) return true;
      const entry = (await readLedger()).find((commitment) => commitment.id === id);
      if (!entry) return true;
      const dir = await this.sessionPath(entry.session_id);
      const meta = dir ? await readMeta(dir) : null;
      const { counterparty } = this.resolveMeetingCounterparty(
        meta ? calendarEventFromMeta(meta) : undefined,
      );
      if (!counterparty) return true;
      await enqueueRelationshipEvidence(
        commitmentStatusObservation({ commitment: entry, status, counterparty }),
      );
      void this.flushRelationshipEvidence();
    } catch (err) {
      console.warn(
        "[meeting] commitment status was saved locally but cloud reconciliation was queued unsuccessfully:",
        err,
      );
    }
    return true;
  }

  /** A session directory, or null when the id does not name one inside the root. */
  private async sessionPath(sessionId: string): Promise<string | null> {
    const root = await this.root();
    const dir = path.join(root, sessionId);
    if (path.dirname(path.resolve(dir)) !== path.resolve(root)) return null;
    return dir;
  }

  /** Bytes every recording occupies, for the privacy tab's "what is on disk". */
  async storageUsage(): Promise<{ sessions: number; bytes: number; dir: string }> {
    const sessions = await this.listSessions();
    return {
      sessions: sessions.length,
      bytes: sessions.reduce((total, session) => total + session.bytes, 0),
      dir: await this.root(),
    };
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
  /** Torn down on every exit from a session, however it ended. */
  private stopLive(): void {
    this.live.stop();
  }

  private async finishSession(dir: string): Promise<boolean> {
    // Every exit from a session lands here — clean stop, sidecar crash, quit — so it is
    // the one place the live pass has to be torn down.
    this.stopLive();
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
        const calendarEvent = calendarEventFromMeta(meta);
        // Named only on a 1:1. Channel attribution puts every counterparty in one
        // bucket, so on a group call this correctly declines and the note stays "Other".
        // No explicit self-address needed: Google marks the local user's own attendee
        // entry with `self: true`, which the resolver already excludes.
        const { counterparty, reason } = this.resolveMeetingCounterparty(calendarEvent);
        const notePath = await writeMeetingNote({
          sessionId,
          startedAt: meta.started,
          segments: transcript.segments,
          calendarEvent,
          speakerLabels: counterparty ? { them: counterparty.label } : undefined,
          provenance: nativeProvenance({
            model: this.modelId,
            sessionId,
            systemAudioCaptured,
            counterparty: counterparty ?? undefined,
            attributionLimit: reason,
          }),
          notePath: this.notePaths.get(sessionId),
        });
        this.notePaths.set(sessionId, notePath);
        this.notePath = notePath;
        return notePath;
      },
      proposeCommitments: async ({ dir, meta, transcript, notePath }) => {
        const settings = await getTranscriptionConfig();
        if (settings.meetings?.extractCommitments === false) return;
        const calendarEvent = calendarEventFromMeta(meta);
        const { counterparty } = this.resolveMeetingCounterparty(calendarEvent);
        const proposals = await extractCommitments({
          segments: transcript.segments,
          labels: { me: "You", them: counterparty?.label ?? "Other" },
        });
        // Written even when empty, so the UI can tell "nothing was proposed" from
        // "extraction has not run yet" — which are different things to show.
        await writeCommitmentProposals(dir, {
          proposals,
          counterparty: counterparty?.label,
          notePath,
          meetingTitle: calendarEvent?.summary,
          meetingStarted: meta.started,
        });
      },
      summarize: async ({ dir, notePath, meta }) => {
        await summarizeMeetingNote({
          dir,
          notePath,
          meta,
          summarize: (transcript, startedAt, calendarEventJson) =>
            summarizeMeeting(transcript, startedAt, calendarEventJson),
        });
      },
      onTranscribed: async ({ dir, meta, transcript, notePath }) => {
        const sessionId = path.basename(dir);
        try {
          await publishMeetingTranscribed({
            sessionId,
            meta,
            transcript,
            notePath,
          });
        } catch (err) {
          // Local automation and shared relationship publication are independent
          // observers. A broken local task must not suppress consented shared evidence.
          console.warn("[meeting] local transcribed event could not be published:", err);
        }
        const settings = await getTranscriptionConfig();
        if (!settings.meetings.syncRelationshipEvidence) return;
        const { counterparty } = this.resolveMeetingCounterparty(calendarEventFromMeta(meta));
        if (!counterparty) return;
        try {
          await enqueueRelationshipEvidence(
            meetingTranscriptObservation({
              sessionId,
              meta,
              transcript,
              counterparty,
              settings: settings.meetings,
            }),
          );
          await this.flushRelationshipEvidence();
        } catch (err) {
          console.warn("[meeting] shared relationship evidence could not be queued:", err);
        }
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

  private async flushRelationshipEvidence(): Promise<void> {
    try {
      // Renderer-only platforms do not initialize the native capture controller at
      // launch, so a cached setting can remain false after restart. Re-read the durable
      // consent immediately before every network drain.
      const config = await getTranscriptionConfig();
      if (!config.meetings.syncRelationshipEvidence) return;
      const result = await flushRelationshipEvidence();
      if (result.error) {
        console.warn(
          `[meeting] ${result.pending} relationship evidence item(s) pending: ${result.error}`,
        );
      } else if (result.sent > 0) {
        console.log(`[meeting] synced ${result.sent} relationship evidence item(s)`);
      }
    } catch (err) {
      // Corruption and filesystem errors are intentionally not converted into an empty
      // outbox. Surface them without creating an unhandled rejection on fire-and-forget
      // launch/config refresh calls.
      console.warn("[meeting] relationship evidence outbox could not be read:", err);
    }
  }

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
    if (config.meetings?.syncRelationshipEvidence) void this.flushRelationshipEvidence();
  }

  get transcriptionProgress(): MeetingTranscriptionProgress | null {
    return this.lastProgress;
  }

  private setState(state: MeetingCaptureState): void {
    this.state = state;
    if (state === "idle") {
      this.liveCounterparty = undefined;
      this.liveCues = [];
      broadcast("meeting:liveCues", { cues: [] });
    }
    // The tray, any open window, and the indicator are all views onto this one piece
    // of state, so every transition notifies all three rather than any of them polling.
    this.onStateChange?.();
    broadcast<MeetingCaptureStatus>("meeting:captureState", this.statusSnapshot());
    // Driven from the transition, not from `start()`/`stop()`, so a session the sidecar
    // ended on its own — a crash, a quit — takes the indicator down with it.
    syncMeetingIndicator(state);
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
