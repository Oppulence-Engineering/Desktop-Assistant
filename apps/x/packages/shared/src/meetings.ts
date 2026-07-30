import { z } from "zod";

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

/** Parakeet model: v3 is multilingual (25 European languages), v2 is English-only. */
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
  /** Queue a session for transcription the moment it stops. */
  transcribeOnStop: z.boolean().default(true),
});
export type MeetingsSettings = z.infer<typeof MeetingsSettings>;

export const DEFAULT_MEETINGS_SETTINGS: MeetingsSettings = {
  captureEngine: "auto",
  micVoiceProcessing: false,
  keepAudio: "untilTranscribed",
  compressRetainedAudio: true,
  transcriptionEngine: "whisper",
  parakeetModel: "v3",
  transcribeOnStop: true,
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
  segments: z.array(MeetingTranscriptSegment),
});
export type MeetingTranscript = z.infer<typeof MeetingTranscript>;

// ---------------------------------------------------------------------------
// Runtime surface
// ---------------------------------------------------------------------------

export const MeetingCaptureState = z.enum(["idle", "starting", "recording", "stopping"]);
export type MeetingCaptureState = z.infer<typeof MeetingCaptureState>;

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
  /** Sessions waiting to transcribe, plus the one in flight. */
  queueDepth: z.number().default(0),
  transcribingSessionId: z.string().optional(),
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
}

export interface MeetingNoteEntry {
  speaker: string;
  text: string;
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
export function segmentsToEntries(segments: MeetingTranscriptSegment[]): MeetingNoteEntry[] {
  const entries: MeetingNoteEntry[] = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    const speaker = SPEAKER_LABEL[segment.speaker];
    const last = entries[entries.length - 1];
    if (last && last.speaker === speaker) {
      last.text += " " + text;
    } else {
      entries.push({ speaker, text });
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
export function formatMeetingNote(
  entries: MeetingNoteEntry[],
  date: string,
  calendarEvent?: MeetingCalendarEvent,
  provenance?: Record<string, string | boolean>,
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

  const transcriptLines: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (i > 0 && entries[i].speaker !== entries[i - 1].speaker) {
      transcriptLines.push("");
    }
    transcriptLines.push(`**${entries[i].speaker}:** ${entries[i].text}`);
    transcriptLines.push("");
  }
  const transcriptText = transcriptLines.join("\n").trim();
  lines.push("```transcript", JSON.stringify({ transcript: transcriptText }), "```");
  return lines.join("\n");
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
