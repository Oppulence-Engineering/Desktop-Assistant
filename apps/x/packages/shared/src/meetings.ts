import { z } from "zod";
import { DictationLanguage } from "./language.js";

/**
 * Native dual-track meeting capture — types shared by core, main, and the renderer.
 *
 * The note formatter lives here rather than in core because the renderer cannot
 * import `@x/core` (main-process only). Both capture engines call it, so a meeting
 * note looks identical whether it came from the sidecar or the renderer pipeline.
 */

// ---------------------------------------------------------------------------
// Capture engine
// ---------------------------------------------------------------------------

/**
 * `native` is the `oppulence-audiocap` sidecar: two tracks, on disk, survives the
 * window closing. `renderer` is the in-page WebAudio pipeline — the only option on
 * Windows/Linux and on macOS below 14.2, where Core Audio process taps don't exist.
 * `auto` resolves to native when it's actually available.
 */
export const MeetingCaptureEngine = z.enum(["auto", "native", "renderer"]);
export type MeetingCaptureEngine = z.infer<typeof MeetingCaptureEngine>;

export const MeetingResolvedEngine = z.enum(["native", "renderer"]);
export type MeetingResolvedEngine = z.infer<typeof MeetingResolvedEngine>;

/**
 * When to delete captured audio. `untilTranscribed` is the default: audio survives long
 * enough to outlive a crash and be re-transcribed, then goes away once
 * `transcript.json` lands (RFC 035 — raw audio is not kept by default).
 *
 * **Deletion always requires a transcript.** There was a third mode, `never`, that
 * deleted when the session ended whether or not one existed; it was removed because the
 * only thing it actually bought was turning any transcription failure into a lost
 * meeting. A persisted `never` reads as `untilTranscribed` so existing configs still
 * load — and land on the safe behaviour they almost certainly wanted.
 */
export const MeetingKeepAudio = z.preprocess(
  (value) => (value === "never" ? "untilTranscribed" : value),
  z.enum(["always", "untilTranscribed"]),
);
export type MeetingKeepAudio = z.infer<typeof MeetingKeepAudio>;

/**
 * Which transcription engine runs after capture.
 *
 * `whisper` is the default: already shipped, no extra download. `parakeet` is roughly
 * ten times faster (tens of seconds per hour of audio rather than minutes) because it
 * runs on the Neural Engine, at the cost of a one-time ~600 MB model download and a
 * dependency on the native sidecar.
 */
export const MeetingTranscriptionEngine = z.enum(["whisper", "parakeet"]);
export type MeetingTranscriptionEngine = z.infer<typeof MeetingTranscriptionEngine>;

/** Parakeet model: v3 is multilingual (28 European languages), v2 is English-only. */
export const ParakeetModel = z.enum(["v3", "v2"]);
export type ParakeetModel = z.infer<typeof ParakeetModel>;

export const MeetingsSettings = z.object({
  captureEngine: MeetingCaptureEngine.default("auto"),
  /** Absolute path, or unset for `<WorkDir>/recordings`. */
  recordingsDir: z.string().optional(),
  /**
   * Apple's echo canceller on the mic. Off by default: on headphones there is no
   * echo to cancel and raw capture is cleaner. Turn it on when the meeting plays
   * through speakers, or their audio is transcribed twice — once as them, once as you.
   */
  micVoiceProcessing: z.boolean().default(false),
  keepAudio: MeetingKeepAudio.default("untilTranscribed"),
  /** Compress retained audio to AAC once transcribed — ~1/8 the size, still playable.
   *  Only applies when `keepAudio` is `always`; there is nothing to compress otherwise. */
  compressRetainedAudio: z.boolean().default(true),
  transcriptionEngine: MeetingTranscriptionEngine.default("whisper"),
  parakeetModel: ParakeetModel.default("v3"),
  /**
   * The spoken language of recorded meetings.
   *
   * `auto` is resolved **once per session** rather than per transcription window: the
   * two-track design guarantees one track is usually near-silent, and a near-silent
   * window is exactly where language detection misfires. Resolving once from the track
   * with the most signal and reusing that code everywhere keeps both sides of a call in
   * the same language.
   *
   * Separate from `dictation.language` on purpose — the language you dictate notes in
   * and the language your meetings are held in are routinely different.
   */
  language: DictationLanguage.default("auto"),
  /** Queue a session for transcription the moment it stops. */
  transcribeOnStop: z.boolean().default(true),
  /**
   * What to do when a calendar meeting with a join link starts.
   *
   * `prompt` is the default and the only one that ships on by default: recording people
   * is consent-shaped, and a notification you can act on or ignore *is* the consent
   * step. `always` skips it, which is a choice a user has to make deliberately —
   * `autoStartSilentOrganizers` is the narrower version of the same choice, for the
   * recurring meetings you have already decided about.
   */
  autoStart: z.enum(["off", "prompt", "always"]).default("prompt"),
  /** Organizer emails whose meetings start recording without asking. */
  autoStartSilentOrganizers: z.array(z.string()).default([]),
  /** Warn before a meeting when this machine is not ready to record it. */
  preflightNotifications: z.boolean().default(true),
  /**
   * How far back "record" can reach when standing by, in seconds. Bounded on purpose:
   * "we hold the last five minutes" is a promise someone can check, and it caps what
   * standby could ever retain at roughly 20 MB of memory across both tracks.
   */
  standbySeconds: z.number().min(30).max(900).default(300),
  /**
   * Open the microphone into the standby buffer a couple of minutes before a calendar
   * meeting, so pressing record catches what was already said.
   *
   * Off by default, and it has to be. Arming a microphone is the one thing here that
   * happens to you rather than because of you, and "we only open it before meetings you
   * scheduled" is a reason, not a consent. The manual control is always available.
   */
  standbyBeforeMeetings: z.boolean().default(false),
  /**
   * Transcribe in the background while the meeting runs, so you can search and ask
   * questions mid-call.
   *
   * Off by default. It is a second transcription pass running during a call, on a
   * machine already busy with the call — cheap on the Neural Engine (roughly a 5% duty
   * cycle with the fast engine) but not free, and not something to spend someone's
   * battery on without asking.
   */
  liveTranscript: z.boolean().default(false),
  /** Sparse local relationship cues derived from the live transcript. Off until the
   *  user explicitly chooses a cadence; cue generation never enables a cloud route. */
  liveCoachingFrequency: z.enum(["off", "minimal", "standard"]).default("off"),
  /**
   * Propose commitments from a finished transcript.
   *
   * On by default — it is gated by a cheap keyword pre-filter, runs once per meeting
   * rather than continuously, and is the thing that turns a transcript into something
   * you act on. But it is still a model call the user did not ask for each time, so it
   * gets a switch like every other model-backed feature here.
   */
  extractCommitments: z.boolean().default(true),
  /**
   * Publish finished 1:1 meeting evidence and human-confirmed commitments to the
   * shared relationship model.
   *
   * Off by default because this sends transcript text to the Oppulence API even when
   * speech-to-text itself ran locally. The settings copy is the consent surface.
   */
  syncRelationshipEvidence: z.boolean().default(false),
});
export type MeetingsSettings = z.infer<typeof MeetingsSettings>;

export const DEFAULT_MEETINGS_SETTINGS: MeetingsSettings = {
  captureEngine: "auto",
  micVoiceProcessing: false,
  keepAudio: "untilTranscribed",
  compressRetainedAudio: true,
  transcriptionEngine: "whisper",
  parakeetModel: "v3",
  language: "auto",
  transcribeOnStop: true,
  autoStart: "prompt",
  autoStartSilentOrganizers: [],
  preflightNotifications: true,
  standbySeconds: 300,
  standbyBeforeMeetings: false,
  liveTranscript: false,
  liveCoachingFrequency: "off",
  extractCommitments: true,
  syncRelationshipEvidence: false,
};

// ---------------------------------------------------------------------------
// Session on disk — written by the sidecar, read by the queue
// ---------------------------------------------------------------------------

/** Which side of the conversation a track holds. */
export const MeetingTrackId = z.enum(["mic", "system"]);
export type MeetingTrackId = z.infer<typeof MeetingTrackId>;

export const MeetingSpeaker = z.enum(["me", "them"]);
export type MeetingSpeaker = z.infer<typeof MeetingSpeaker>;

/** Transcript labels. Same strings the renderer pipeline already writes, so old and
 *  new notes render identically in the transcript block. */
export const SPEAKER_LABEL: Record<MeetingSpeaker, string> = { me: "You", them: "Other" };

export const MeetingTrackMeta = z.object({
  id: MeetingTrackId,
  speaker: MeetingSpeaker,
  file: z.string(),
  /** Milliseconds this track's first buffer lagged the earliest track's. Both
   *  transcripts are shifted by it so they share one clock. */
  offset_ms: z.number().default(0),
  frames: z.number().default(0),
  duration_ms: z.number().default(0),
  /** Peak amplitude 0…1 over the whole track. */
  peak: z.number().default(0),
  /** True when the track never saw a non-zero sample: correct duration, no signal. */
  silent: z.boolean().default(false),
  voice_processing: z.boolean().optional(),
  voice_processing_fell_back: z.boolean().optional(),
});
export type MeetingTrackMeta = z.infer<typeof MeetingTrackMeta>;

/**
 * An explicit user-selected destination in the shared relationship model.
 * The stable id is authoritative; the other fields are a display snapshot for
 * offline notes and review surfaces. Keeping this in session metadata means a
 * crash/restart cannot make the publication fall back to identity guessing.
 */
export const MeetingRelationshipTarget = z.object({
  relationshipId: z.string().uuid(),
  displayName: z.string().min(1),
  primaryEmail: z.string().optional(),
  accountDomain: z.string().optional(),
});
export type MeetingRelationshipTarget = z.infer<typeof MeetingRelationshipTarget>;

export const MeetingAudioFormat = z.object({
  sample_rate: z.number(),
  channels: z.number(),
  encoding: z.literal("pcm_s16le"),
  container: z.literal("wav"),
});
export type MeetingAudioFormat = z.infer<typeof MeetingAudioFormat>;

/**
 * `meta.json`. Its presence is what marks a session finished — the queue treats a
 * directory with `meta.json` and no `transcript.json` as pending work, so the
 * sidecar writes it last and atomically.
 */
export const MeetingSessionMeta = z.object({
  schema: z.literal(1),
  sidecar_version: z.string().optional(),
  started: z.string(),
  ended: z.string(),
  duration_seconds: z.number(),
  audio: MeetingAudioFormat,
  tracks: z.array(MeetingTrackMeta),
  warnings: z.array(z.string()).default([]),
  /** Added by the host, not the sidecar. */
  calendar_event: z.string().optional(),
  relationship_target: MeetingRelationshipTarget.optional(),
  app_version: z.string().optional(),
  audio_deleted_at: z.string().optional(),
});
export type MeetingSessionMeta = z.infer<typeof MeetingSessionMeta>;

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

export const MeetingTranscriptSegment = z.object({
  speaker: MeetingSpeaker,
  start_ms: z.number(),
  end_ms: z.number(),
  text: z.string(),
});
export type MeetingTranscriptSegment = z.infer<typeof MeetingTranscriptSegment>;

export const MeetingTranscript = z.object({
  schema: z.literal(1),
  engine: z.string(),
  model: z.string(),
  created_at: z.string(),
  /**
   * The language the engine actually transcribed in — the *effective* one, not the
   * requested one. whisper.cpp silently ignores `--language` on an English-only model
   * and reports `en` regardless, so recording what was asked for would be a lie in
   * exactly the case a reader needs the truth.
   *
   * Optional: transcripts written before this existed stay valid at `schema: 1`.
   */
  language: z.string().optional(),
  /** Whether {@link language} was detected by the engine or set by the user. */
  language_detected: z.boolean().optional(),
  segments: z.array(MeetingTranscriptSegment),
});
export type MeetingTranscript = z.infer<typeof MeetingTranscript>;

// ---------------------------------------------------------------------------
// Runtime surface
// ---------------------------------------------------------------------------

/**
 * `standby` is capture running with nothing written to disk — the last few minutes held
 * in memory so "record" can reach backwards. It is a distinct state and not a flavour of
 * recording, because every surface has to be able to show the difference: a live
 * microphone the user cannot see is exactly what this product refuses to be.
 */
export const MeetingCaptureState = z.enum(["idle", "starting", "standby", "recording", "stopping"]);
export type MeetingCaptureState = z.infer<typeof MeetingCaptureState>;

export const CaptureHealthKind = z.enum([
  "microphone_missing",
  "microphone_silent",
  "microphone_stalled",
  "system_track_missing",
  "system_track_silent",
  "system_track_stalled",
  "sidecar_stalled",
  "sidecar_crashed",
  "disk_pressure",
  "model_unavailable",
  "live_transcription_stale",
  "post_transcription_stuck",
]);
export type CaptureHealthKind = z.infer<typeof CaptureHealthKind>;

export const CaptureHealthEvent = z.object({
  eventId: z.string(),
  sessionId: z.string(),
  kind: CaptureHealthKind,
  severity: z.enum(["warning", "critical", "recovered"]),
  detectedAt: z.string(),
  impact: z.string(),
  remediation: z.string(),
  trackId: MeetingTrackId.optional(),
  redactedDiagnostics: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
export type CaptureHealthEvent = z.infer<typeof CaptureHealthEvent>;

export const CaptureHealthSnapshot = z.object({
  guardianVersion: z.literal("capture-guardian-v1"),
  status: z.enum(["healthy", "warning", "critical"]),
  activeEvents: z.array(CaptureHealthEvent),
  timeline: z.array(CaptureHealthEvent),
  lastCheckedAt: z.string(),
});
export type CaptureHealthSnapshot = z.infer<typeof CaptureHealthSnapshot>;

export const MeetingCaptureStatus = z.object({
  state: MeetingCaptureState,
  engine: MeetingResolvedEngine.optional(),
  sessionId: z.string().optional(),
  startedAt: z.string().optional(),
  elapsedSeconds: z.number().optional(),
  notePath: z.string().optional(),
  /** Track ids that opened successfully — absence of `system` means one-sided capture. */
  tracks: z.array(MeetingTrackId).default([]),
  warnings: z.array(z.string()).default([]),
  /** How far back a standby session can reach, in seconds. Zero when not standing by. */
  standbySeconds: z.number().default(0),
  /** Sessions waiting to transcribe, plus the one in flight. */
  queueDepth: z.number().default(0),
  transcribingSessionId: z.string().optional(),
  captureHealth: CaptureHealthSnapshot.optional(),
});
export type MeetingCaptureStatus = z.infer<typeof MeetingCaptureStatus>;

/** Peak per track, 0…1, ~5×/second. Also proof of life: all-zero for a whole
 *  meeting means the track recorded digital silence. */
export const MeetingLevels = z.object({
  sessionId: z.string(),
  peaks: z.record(MeetingTrackId, z.number()),
});
export type MeetingLevels = z.infer<typeof MeetingLevels>;

export const MeetingSessionSummary = z.object({
  id: z.string(),
  dir: z.string(),
  startedAt: z.string(),
  durationSeconds: z.number(),
  transcribed: z.boolean(),
  hasAudio: z.boolean(),
  notePath: z.string().optional(),
  segmentCount: z.number().optional(),
  tracks: z.array(MeetingTrackMeta).default([]),
  warnings: z.array(z.string()).default([]),
  relationshipTarget: MeetingRelationshipTarget.optional(),
  /** Bytes this session occupies on disk, audio included. Summed rather than stored so
   *  it stays right after retention compresses or deletes the audio underneath it. */
  bytes: z.number().default(0),
  /** Last transcription failure for this session, if any. */
  error: z.string().optional(),
});
export type MeetingSessionSummary = z.infer<typeof MeetingSessionSummary>;

export const MeetingDoctorCheck = z.object({
  name: z.string(),
  status: z.enum(["ok", "warn", "fail"]),
  detail: z.string(),
  remediation: z.string().optional(),
});
export type MeetingDoctorCheck = z.infer<typeof MeetingDoctorCheck>;

export const MeetingDoctorReport = z.object({
  ok: z.boolean(),
  /** False when the sidecar is missing or the OS is too old — the renderer engine
   *  is then the only option, and the checks below describe it instead. */
  nativeAvailable: z.boolean(),
  sidecarVersion: z.string().optional(),
  checks: z.array(MeetingDoctorCheck).default([]),
});
export type MeetingDoctorReport = z.infer<typeof MeetingDoctorReport>;

export const MeetingPreflightReport = z.object({
  ok: z.boolean(),
  /** Only readiness problems are returned; an empty list means capture,
   * storage, and the configured transcription route are ready. */
  problems: z.array(MeetingDoctorCheck).default([]),
});
export type MeetingPreflightReport = z.infer<typeof MeetingPreflightReport>;

/** Progress pushed while a session transcribes. */
export const MeetingTranscriptionProgress = z.object({
  sessionId: z.string(),
  phase: z.enum(["queued", "transcribing", "writing", "done", "failed"]),
  queueDepth: z.number().default(0),
  /** 0…1 within the current session, when known. */
  fraction: z.number().optional(),
  notePath: z.string().optional(),
  error: z.string().optional(),
});
export type MeetingTranscriptionProgress = z.infer<typeof MeetingTranscriptionProgress>;

// ---------------------------------------------------------------------------
// Note rendering
// ---------------------------------------------------------------------------

export interface MeetingCalendarEvent {
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  htmlLink?: string;
  conferenceLink?: string;
  source?: string;
  /**
   * Kept in `meta.json` so the queue can name the counterparty when it writes the note,
   * without re-reading the calendar. Deliberately **not** serialized into the note's
   * `calendar_event` frontmatter below: a note is a file people read, edit and share,
   * and a roster of email addresses does not need to travel with it.
   */
  attendees?: {
    email?: string;
    displayName?: string;
    self?: boolean;
    resource?: boolean;
    responseStatus?: string;
  }[];
  organizer?: { email?: string; displayName?: string };
}

export interface MeetingNoteEntry {
  speaker: string;
  text: string;
  /** Where in the recording this line starts. Absent for entries built from text
   *  alone — an imported transcript, or a note someone typed. */
  start_ms?: number;
  end_ms?: number;
  track?: "mic" | "system";
}

/** `mm:ss`, or `h:mm:ss` past an hour. */
export function clockLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Collapse timed segments into note entries, merging consecutive turns from the
 * same speaker — the note reads as a conversation, not a list of utterances.
 */
export function segmentsToEntries(
  segments: MeetingTranscriptSegment[],
  /** Overrides for the default `You` / `Other`. Only supplied when the counterparty
   *  could be named with confidence — see `meetings/attendees.ts`. */
  labels: Partial<Record<MeetingSpeaker, string>> = {},
): MeetingNoteEntry[] {
  const entries: MeetingNoteEntry[] = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    const speaker = labels[segment.speaker] ?? SPEAKER_LABEL[segment.speaker];
    const last = entries[entries.length - 1];
    if (last && last.speaker === speaker) {
      last.text += " " + text;
      // Merged runs keep the *first* start and the *last* end, so clicking the
      // paragraph seeks to where the person began speaking rather than to the last
      // fragment that happened to be appended to it.
      last.end_ms = segment.end_ms;
    } else {
      entries.push({
        speaker,
        text,
        start_ms: segment.start_ms,
        end_ms: segment.end_ms,
        track: segment.speaker === "me" ? "mic" : "system",
      });
    }
  }
  return entries;
}

/**
 * The meeting note: flat YAML frontmatter (the frontmatter system has no nested
 * support, so objects are JSON on one line) followed by a fenced `transcript` block
 * the editor renders as a first-class node.
 *
 * `meeting:summarize` later prepends its notes *above* that block, so the block must
 * stay last and its shape must not drift — both capture engines call this one
 * function precisely so they can't.
 */
/**
 * The one-line "this stayed here" notice at the top of a locally-captured note.
 *
 * The app already knew every fact behind this and had never said one of them out loud.
 * Privacy that is only true in the implementation is not a feature anyone can act on.
 *
 * Scope is deliberately narrow. `audio_uploaded: false` is set exactly when
 * transcription ran on-device, so it licenses a claim about the recording and the
 * transcript — and nothing else. It says nothing about the summary, which goes to
 * whichever model is configured and is frequently a cloud API. A notice that overstates
 * by one clause is worse than no notice, because it teaches people not to trust the rest.
 */
export function localCaptureNotice(provenance?: Record<string, string | boolean>): string | null {
  if (!provenance || provenance.audio_uploaded !== false) return null;
  return "> Recorded and transcribed on this Mac. The audio never left this device.";
}

/**
 * The line that says "Other" is a bucket, not a person.
 *
 * Only emitted when it could actually mislead — a call with several counterparties, all
 * of whom land in one channel. On a 1:1 the speaker is named and there is nothing to
 * warn about; on a solo recording there is no counterparty at all. A caveat printed on
 * every note is a caveat nobody reads on the one where it mattered.
 */
export function attributionNotice(provenance?: Record<string, string | boolean>): string | null {
  const attribution = provenance?.speaker_attribution;
  if (typeof attribution !== "string") return null;
  const multiParty = /(\d+) other participants/.exec(attribution);
  if (!multiParty) return null;
  return `> Speakers are separated by audio channel, not by voice — so all ${multiParty[1]} other participants appear as **Other**.`;
}

export function formatMeetingNote(
  entries: MeetingNoteEntry[],
  date: string,
  calendarEvent?: MeetingCalendarEvent,
  provenance?: Record<string, string | boolean>,
  /** Ties the block's timings to a recording so a click can seek into it. */
  sessionId?: string,
): string {
  const noteTitle = calendarEvent?.summary || "Meeting Notes";
  const lines = [
    "---",
    "type: meeting",
    // Kept as `solomon` regardless of capture engine: this is the "we recorded it"
    // source, as opposed to the fireflies/granola importers, and note listing
    // filters on it.
    "source: solomon",
    `title: ${noteTitle}`,
    `date: "${date}"`,
  ];
  if (provenance) {
    for (const [key, value] of Object.entries(provenance)) {
      lines.push(`${key}: ${typeof value === "string" ? value : value ? "true" : "false"}`);
    }
  }
  if (calendarEvent) {
    const eventObj: Record<string, string> = {};
    if (calendarEvent.summary) eventObj.summary = calendarEvent.summary;
    if (calendarEvent.start?.dateTime) eventObj.start = calendarEvent.start.dateTime;
    else if (calendarEvent.start?.date) eventObj.start = calendarEvent.start.date;
    if (calendarEvent.end?.dateTime) eventObj.end = calendarEvent.end.dateTime;
    else if (calendarEvent.end?.date) eventObj.end = calendarEvent.end.date;
    if (calendarEvent.location) eventObj.location = calendarEvent.location;
    if (calendarEvent.htmlLink) eventObj.htmlLink = calendarEvent.htmlLink;
    if (calendarEvent.conferenceLink) eventObj.conferenceLink = calendarEvent.conferenceLink;
    if (calendarEvent.source) eventObj.source = calendarEvent.source;
    lines.push(`calendar_event: '${JSON.stringify(eventObj).replace(/'/g, "''")}'`);
  }
  lines.push("---", "", `# ${noteTitle}`, "");
  // The notices open the generated region rather than floating under the title, so the
  // one rule "this app owns the region and nothing else" covers them too. A summary is
  // appended into the same region later by `mergeSummaryIntoNote`.
  lines.push(GENERATED_SECTION_HEADING, "");
  const notice = localCaptureNotice(provenance);
  if (notice) lines.push(notice, "");
  const attribution = attributionNotice(provenance);
  if (attribution) lines.push(attribution, "");
  // Closes the generated region. Everything from here to the transcript belongs to the
  // user and is copied through untouched by every later write.
  lines.push(USER_SECTION_HEADING, "");

  const transcriptLines: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && entries[i].speaker !== entries[i - 1].speaker) {
      transcriptLines.push("");
    }
    transcriptLines.push(`**${entries[i].speaker}:** ${entries[i].text}`);
    transcriptLines.push("");
  }
  const transcriptText = transcriptLines.join("\n").trim();
  // Timings ride alongside the text rather than replacing it: `transcript` stays the
  // one source of truth for what was said, so a note whose block loses its segments —
  // hand-edited, imported, written by an older build — still reads identically.
  const timed = entries.filter(
    (entry): entry is MeetingNoteEntry & { start_ms: number; end_ms: number } =>
      typeof entry.start_ms === "number" && typeof entry.end_ms === "number",
  );
  const block: Record<string, unknown> = { transcript: transcriptText };
  if (timed.length > 0) {
    block.segments = timed.map((entry) => ({
      speaker: entry.speaker,
      text: entry.text,
      start_ms: entry.start_ms,
      end_ms: entry.end_ms,
      ...(entry.track ? { track: entry.track } : {}),
    }));
    if (sessionId) block.sessionId = sessionId;
  }
  lines.push("```transcript", JSON.stringify(block), "```");
  return lines.join("\n");
}

/**
 * The heading that opens the generated region of a meeting note.
 *
 * **Why a heading and not an HTML comment.** The obvious delimiter is
 * `<!-- generated:start -->`, and it does not work here. The note editor serializes its
 * body from the ProseMirror document (`markdown-editor.tsx`, `serializeBlocksToMarkdown`),
 * whose node list has no comment node, and ProseMirror's DOM parser discards comment
 * nodes outright. The markers would survive on disk right up until the user edited the
 * note in the app — which is the exact moment this whole mechanism exists to protect.
 * A heading is a first-class editor node and round-trips unharmed.
 */
export const GENERATED_SECTION_HEADING = "## Meeting summary";

/**
 * The heading that closes the generated region and opens the user's.
 *
 * Without an explicit end the region runs to the transcript block, which quietly makes
 * every line a user types under the summary part of "ours" — and deleted on the next
 * write. That is the same bug in a new place. This heading bounds the region and, just
 * as usefully, gives the user a labelled place to type.
 */
export const USER_SECTION_HEADING = "## Notes";

/**
 * Everything from {@link GENERATED_SECTION_HEADING} to the next `## ` heading or the
 * transcript block, whichever comes first.
 *
 * Returns `null` when the note has no generated region — a note written before this
 * existed, or one whose heading the user renamed. Callers must treat that as "all of
 * this is the user's" and add a region rather than guessing which prose was ours.
 */
function findGeneratedRegion(body: string): { start: number; end: number } | null {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() === GENERATED_SECTION_HEADING);
  if (start === -1) return null;
  let end = lines.length;
  let closed = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ") || line.startsWith("# ")) {
      end = i;
      closed = true;
      break;
    }
    if (line.startsWith("```transcript")) {
      end = i;
      break;
    }
  }
  // An *unclosed* region — the user deleted the heading that ended it — is not safe to
  // replace. Anything they typed under the summary is now inside these bounds and
  // indistinguishable from it, so the caller must fall back to preserving the lot.
  // Treating it as ours would delete their text, which is the bug this file exists to
  // stop, one layer further in.
  return closed ? { start, end } : null;
}

/** The fenced transcript block, which is an editor node and always sorts last. */
function findTranscriptBlock(body: string): string {
  return body.match(/(```transcript\n[\s\S]*?\n```)/)?.[1] ?? "";
}

/**
 * Rewrite only the parts of a meeting note this app owns, leaving the user's alone.
 *
 * Meeting notes are opened and typed into *while the meeting is still running* — that is
 * the point of writing the note at capture start. Both of the writers that run afterwards
 * used to rebuild the body from scratch, so a note that said anything the user put there
 * came back empty. Nothing here deletes text it did not write.
 *
 * The three cases, and why each resolves the way it does:
 *
 * - **Region present** — replace it in place. Everything above and below, and the
 *   transcript block, is copied through untouched.
 * - **No region (a note from before this change, or one whose heading was edited)** —
 *   treat the entire body as the user's, and insert the region under the title. An
 *   already-summarized note keeps its old summary and gains the new one; two summaries
 *   is a thing the user can fix in a second, and a deleted paragraph is not.
 * - **No note yet** — write the whole thing.
 *
 * Every ambiguity above resolves toward keeping text. That direction is the feature.
 */
export function applyGeneratedSection(
  existing: string | null | undefined,
  args: { frontmatter: string | null; title: string; generated: string; transcriptBlock: string },
): string {
  const section = [GENERATED_SECTION_HEADING, "", args.generated.trim()].join("\n").trimEnd();

  if (!existing || !existing.trim()) {
    const parts = [`# ${args.title}`, "", section];
    if (args.transcriptBlock) parts.push("", args.transcriptBlock);
    const body = parts.join("\n");
    return args.frontmatter ? `${args.frontmatter}\n${body}` : body;
  }

  const { raw, body } = splitFrontmatter(existing);
  // Frontmatter is regenerated (provenance changes between the placeholder write and the
  // transcribed one); the body is the part that belongs to the user.
  const frontmatter = args.frontmatter ?? raw;
  const transcriptBlock = args.transcriptBlock || findTranscriptBlock(body);

  // The transcript block is rebuilt from the transcript every time, so drop the old copy
  // wherever it sits and re-append it last.
  const withoutTranscript = body.replace(/```transcript\n[\s\S]*?\n```/g, "").trimEnd();

  const lines = withoutTranscript.split("\n");
  const region = findGeneratedRegion(withoutTranscript);

  let merged: string;
  if (region) {
    merged = [...lines.slice(0, region.start), section, ...lines.slice(region.end)].join("\n");
  } else {
    // Insert directly under the H1 so the summary still reads first, and keep every
    // other line — including any previous summary — exactly where the user last saw it.
    let insertAt = 0;
    while (insertAt < lines.length && lines[insertAt].trim() === "") insertAt++;
    if (lines[insertAt]?.startsWith("# ")) insertAt++;
    const rest = lines.slice(insertAt);
    const restText = rest.join("\n").trim();
    // The carried-over body needs a heading in front of it, or the region we just
    // inserted would run straight into it and absorb it on the next write. The content
    // itself is not moved or reordered — a heading line is added above it.
    const restNeedsHeading = restText !== "" && !restText.startsWith("## ");
    merged = [
      ...lines.slice(0, insertAt),
      "",
      section,
      ...(restText ? ["", ...(restNeedsHeading ? [USER_SECTION_HEADING, ""] : []), ...rest] : []),
    ].join("\n");
  }

  merged = merged.replace(/\n{3,}/g, "\n\n").trimEnd();
  if (transcriptBlock) merged += `\n\n${transcriptBlock}`;
  return frontmatter ? `${frontmatter}\n${merged}` : merged;
}

/**
 * Split a note into its raw frontmatter and body, preserving the frontmatter text
 * exactly. Re-parsing and re-serializing it would reorder keys and reformat the
 * one-line JSON in `calendar_event`.
 */
function splitFrontmatter(content: string): { raw: string | null; body: string } {
  if (!content.startsWith("---")) return { raw: null, body: content };
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) return { raw: null, body: content };
  const closingEnd = endIndex + 4; // '\n---'
  return { raw: content.slice(0, closingEnd), body: content.slice(closingEnd).replace(/^\n/, "") };
}

/**
 * Put an LLM summary above the transcript in a meeting note.
 *
 * The transcript block is preserved verbatim and stays last — it is an editor node, and
 * `meeting:summarize` is defined as prepending above it. The model's own H1/H2 is
 * stripped because the note already has a title from its frontmatter.
 *
 * Lives here rather than in either capture path because both of them do this, and a note
 * whose shape depends on which engine recorded it is a note two things can disagree
 * about.
 */
export function mergeSummaryIntoNote(noteContent: string, summary: string): string {
  const { raw, body } = splitFrontmatter(noteContent);
  const titleMatch = noteContent.match(/^title:\s*(.+)$/m);
  const noteTitle = titleMatch?.[1]?.trim() || "Meeting Notes";
  const cleaned = summary.replace(/^#{1,2}\s+.+\n+/, "");

  // The notices are ours, so they belong inside the generated region and are re-derived
  // rather than scavenged back out of the previous body.
  const existingNotices = notices(body).trim();
  const generated = [existingNotices, cleaned.trim()].filter(Boolean).join("\n\n");

  return applyGeneratedSection(noteContent, {
    frontmatter: raw,
    title: noteTitle,
    generated,
    transcriptBlock: findTranscriptBlock(body),
  });
}

/**
 * The blockquote lines directly under the title, re-emitted above the summary.
 *
 * This rebuild is otherwise destructive: it keeps the title and the transcript block and
 * throws away everything between them. That silently deleted the two standing claims a
 * note makes about itself — "the audio never left this device", and "all N other
 * participants appear as Other" — from every meeting that got summarized, which is every
 * meeting with speech in it. A trust notice that disappears the moment the note becomes
 * useful is worse than one that was never written.
 *
 * Only leading blockquotes are carried, and only until the first non-quote line: those
 * are notices this formatter emitted. Anything further down is the previous summary,
 * which is exactly what is being replaced.
 */
function notices(body: string): string {
  const lines = body.split("\n");
  const region = findGeneratedRegion(body);
  // Once a note has a generated region the notices live inside it, directly under the
  // heading. Only a note written before that existed still has them under the title.
  if (region) return leadingQuotes(lines, region.start + 1);

  let index = 0;
  // Blank lines first: `splitFrontmatter` leaves one in front of the title.
  while (index < lines.length && lines[index].trim() === "") index++;
  if (lines[index]?.startsWith("# ")) index++;
  return leadingQuotes(lines, index);
}

/**
 * The run of blockquote lines starting at `from`.
 *
 * Blank lines are skipped rather than treated as the end of the run: the formatter
 * separates each notice with one, so stopping at the first blank kept only the privacy
 * line and still dropped the speaker-attribution caveat. The run ends at the first line
 * that is neither blank nor a quote — which is where the summary starts.
 */
function leadingQuotes(lines: string[], from: number): string {
  const kept: string[] = [];
  for (let index = from; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === "") continue;
    if (!line.startsWith(">")) break;
    kept.push(line);
  }
  return kept.length > 0 ? kept.join("\n\n") : "";
}

/** The transcript text a summarizer should be given, or "" when there is none yet. */
export function transcriptTextFromNote(noteContent: string): string {
  const block = noteContent.match(/```transcript\n([\s\S]*?)\n```/)?.[1];
  if (!block) return "";
  try {
    return (JSON.parse(block) as { transcript?: string }).transcript?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Human-readable sibling of `transcript.json`, timestamped for skimming. */
export function renderTranscriptMarkdown(transcript: MeetingTranscript, title: string): string {
  const lines = [`# ${title}`, "", `engine: ${transcript.engine} (${transcript.model})`, ""];
  for (const segment of transcript.segments) {
    lines.push(
      `**[${clockLabel(segment.start_ms)}] ${SPEAKER_LABEL[segment.speaker]}:** ${segment.text}`,
    );
    lines.push("");
  }
  return lines.join("\n");
}
