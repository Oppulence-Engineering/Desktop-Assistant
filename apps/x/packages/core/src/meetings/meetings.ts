/**
 * Local dual-track meeting capture — the host-side half.
 *
 * The `oppulence-audiocap` sidecar (`vendor/audiocap`) records; everything here owns
 * what happens around it: session directories, the transcription queue, the workspace
 * note, and audio retention. Electron-free on purpose — the main process injects the
 * transcriber and the note writer, so this is all testable without an app.
 *
 * The organizing idea is that **the filesystem is the state**. A session directory
 * with `meta.json` and no `transcript.json` is pending work, discoverable after a
 * crash or a quit, with no index to fall out of sync.
 */

export {
  appendLog,
  createSessionDir,
  exists,
  patchMeta,
  readMeta,
  recordingsRoot,
  sessionId,
  writeJsonAtomic,
  META_FILE,
  TRANSCRIBE_LOG,
  TRANSCRIPT_JSON,
  TRANSCRIPT_MD,
} from "./session.js";

export { MeetingQueue, pendingSessions, sessionDirs } from "./queue.js";
export type { MeetingQueueDeps } from "./queue.js";

export { CHUNK_SECONDS, SILENCE_PEAK_THRESHOLD, transcribeSession } from "./transcribe.js";
export type { MeetingTranscriber, TranscribeSessionOpts } from "./transcribe.js";

export { applyRetention, hasAudio } from "./retention.js";

export { withTranscriberFallback } from "./fallback.js";
export type { FallbackOpts } from "./fallback.js";

export { compressedName, decodedName, isCompressed, COMPRESSED_EXTENSION } from "./codec.js";
export type { AudioCodec } from "./codec.js";

export { recoverOrphanedSessions, recoverSessionMeta, RECOVERED_WARNING } from "./recover.js";

export {
  calendarEventFromMeta,
  meetingNotePath,
  nativeProvenance,
  writeMeetingNote,
} from "./note.js";
export type { MeetingProvenance, WriteMeetingNoteArgs } from "./note.js";

export { listSessionSummaries, readTranscript } from "./list.js";

export { readPcmChunk, readWavInfo, recoverWavHeader, WavError } from "./wav.js";
export type { WavInfo } from "./wav.js";
