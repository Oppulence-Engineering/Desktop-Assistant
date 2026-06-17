import { z } from "zod";
import {
  DEFAULT_DIARIZATION_SETTINGS,
  DiarizationSettings,
  TranscriptionProvider,
} from "./transcription.js";

/**
 * On-device meeting diarization types (RFC 017).
 *
 * Diarization answers "who spoke when". It is layered on top of the RFC 009
 * local transcription pipeline: whisper.cpp produces words/segments; this layer
 * assigns each speech turn an anonymous, **meeting-scoped** speaker label. No
 * biometric voice identity is persisted across meetings in v1.
 *
 * These are the canonical shapes shared by the renderer, the main process, and
 * the persisted config. Raw embedding vectors are NEVER part of a serialized
 * shape (privacy, §"Privacy detail"): only opaque local centroid references are.
 */

/**
 * The kind of a local model asset the model manager installs (RFC 017
 * §"Model manager extensions"). Extends RFC 009's transcription-only catalog.
 */
export const LocalModelKind = z.enum(["transcription", "vad", "speaker_embedding"]);
export type LocalModelKind = z.infer<typeof LocalModelKind>;

/**
 * Diarization mode recorded in provenance and surfaced in the note header.
 * `off` = transcript only (no speaker attribution); `beta` = local beta
 * diarization; `default` = diarization has graduated to the default (gated on
 * the quality gates, not yet reached in v1).
 */
export const DiarizationMode = z.enum(["off", "beta", "default"]);
export type DiarizationMode = z.infer<typeof DiarizationMode>;

/** How a transcript segment was attributed to a speaker. */
export const DiarizationAssignmentMethod = z.enum([
  "embedding_cluster",
  "channel_fallback",
  "unknown",
]);
export type DiarizationAssignmentMethod = z.infer<typeof DiarizationAssignmentMethod>;

/** The reserved label used when confidence is too low to attribute a speaker. */
export const UNKNOWN_SPEAKER_LABEL = "Unknown speaker";

/** Build the anonymous display name for the Nth speaker (1-based). */
export function speakerDisplayName(index: number): string {
  return `Speaker ${index}`;
}

/**
 * A local, meeting-scoped speaker label (RFC 017 §4). `displayName` is anonymous
 * ("Speaker 1", "Unknown speaker"); renaming to a real name is meeting-local and
 * does not create a reusable voice profile.
 */
export const LocalSpeakerLabel = z.object({
  meetingId: z.string(),
  speakerId: z.string(),
  displayName: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});
export type LocalSpeakerLabel = z.infer<typeof LocalSpeakerLabel>;

/**
 * A VAD-detected speech region (RFC 017 §"Audio segment model"). `audioRef` is a
 * local memory/temp reference, never a cloud identifier.
 */
export const SpeechSegment = z.object({
  segmentId: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  channel: z.number().int().optional(),
  vadConfidence: z.number().min(0).max(1),
  audioRef: z.string(),
});
export type SpeechSegment = z.infer<typeof SpeechSegment>;

/** A single transcribed word with optional per-word speaker attribution. */
export const TranscriptWord = z.object({
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  confidence: z.number().optional(),
  speakerId: z.string().optional(),
});
export type TranscriptWord = z.infer<typeof TranscriptWord>;

/**
 * A transcript segment with optional speaker attribution (RFC 017 §"Transcript
 * segment model"). Word-level labels are preferred when available; segment-level
 * labels are acceptable for beta.
 */
export const TranscriptSegment = z.object({
  segmentId: z.string(),
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  words: z.array(TranscriptWord).optional(),
  speakerId: z.string().optional(),
  speakerConfidence: z.number().min(0).max(1).optional(),
  provider: z.literal("whisper.cpp"),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

/** A clustered speaker within one meeting session. */
export const DiarizationSpeaker = z.object({
  speakerId: z.string(),
  displayName: z.string(),
  /** Opaque local reference to the centroid (never the raw vector). */
  embeddingCentroidRef: z.string(),
  firstSeenMs: z.number(),
  lastSeenMs: z.number(),
  segmentCount: z.number().int().nonnegative(),
});
export type DiarizationSpeaker = z.infer<typeof DiarizationSpeaker>;

/** The attribution of one speech/transcript segment to a speaker. */
export const DiarizationAssignment = z.object({
  segmentId: z.string(),
  speakerId: z.string(),
  confidence: z.number().min(0).max(1),
  method: DiarizationAssignmentMethod,
});
export type DiarizationAssignment = z.infer<typeof DiarizationAssignment>;

/** Full meeting-scoped diarization state (RFC 017 §"Diarization state model"). */
export const DiarizationState = z.object({
  sessionId: z.string(),
  modelVersion: z.string(),
  speakers: z.array(DiarizationSpeaker),
  assignments: z.array(DiarizationAssignment),
});
export type DiarizationState = z.infer<typeof DiarizationState>;

/**
 * A label-correction patch emitted when a trailing refinement pass changes an
 * earlier assignment (e.g. "Speaker 2" -> "Speaker 1"). Applied to the
 * transcript by stable segment id (RFC 017 §"Online versus trailing refinement").
 */
export const SpeakerCorrection = z.object({
  segmentId: z.string(),
  fromSpeakerId: z.string().optional(),
  toSpeakerId: z.string(),
  fromDisplayName: z.string().optional(),
  toDisplayName: z.string(),
});
export type SpeakerCorrection = z.infer<typeof SpeakerCorrection>;

/**
 * The provenance recorded on each locally diarized meeting note (RFC 017
 * §"Provenance"). Visible in the same trust surface as RFC 014.
 */
export const DiarizationProvenance = z.object({
  transcription_provider: z.string(),
  transcription_model: z.string(),
  diarization_provider: z.enum(["local", "deepgram", "none"]),
  diarization_model: z.string().optional(),
  diarization_mode: DiarizationMode,
  audio_uploaded: z.boolean(),
  speaker_identity_persistence: z.enum(["meeting_only", "none"]),
});
export type DiarizationProvenance = z.infer<typeof DiarizationProvenance>;

/**
 * The three user-facing meeting states (RFC 017 §"User-facing behavior").
 * Derived, not persisted directly — see core `resolveMeetingDiarizationState`.
 */
export const MeetingDiarizationState = z.enum([
  "cloud_meetings_default",
  "local_diarization_beta",
  "local_transcript_no_diarization",
]);
export type MeetingDiarizationState = z.infer<typeof MeetingDiarizationState>;

/**
 * Re-export the provider enum + the diarization settings schema/default (which
 * live in transcription.ts to avoid a circular import) so consumers can pull the
 * whole diarization surface from one import.
 */
export { TranscriptionProvider, DiarizationSettings, DEFAULT_DIARIZATION_SETTINGS };
