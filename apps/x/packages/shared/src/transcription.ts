import { z } from "zod";

/**
 * Transcription provider abstraction (RFC 009 §12).
 *
 * - `solomon`       — Deepgram fronted by the Solomon proxy (signed-in, billed).
 * - `deepgram`      — Deepgram direct with the user's own key (BYOK).
 * - `whisper-local` — on-device whisper.cpp; $0/min, private, offline.
 *
 * These are the canonical values shared by the renderer, the main process, and
 * the persisted `transcription.json` config.
 */
export const TranscriptionProvider = z.enum(["solomon", "deepgram", "whisper-local"]);
export type TranscriptionProvider = z.infer<typeof TranscriptionProvider>;

/** Cloud providers (everything that is not on-device). Used by the fallback logic. */
export function isCloudProvider(provider: TranscriptionProvider): boolean {
  return provider === "solomon" || provider === "deepgram";
}

/**
 * Hardware acceleration backend reported by the capability probe (RFC 009 §13).
 * Ordered loosely by preference; `cpu` is the always-available fallback.
 */
export const WhisperAccel = z.enum(["coreml", "metal", "cuda", "vulkan", "cpu"]);
export type WhisperAccel = z.infer<typeof WhisperAccel>;

/**
 * Every local-transcription failure returns one of these codes (RFC 009 §11/§18).
 * The renderer switches on the code to pick a recovery action — never a parsed
 * message — mirroring the cloud error-code pattern.
 */
export const WhisperErrorCode = z.enum([
  "engine_unavailable",
  "device_unsupported",
  "model_not_installed",
  "download_failed",
  "checksum_mismatch",
  "insufficient_disk",
  "engine_timeout",
  "engine_crashed",
  "audio_invalid",
  "busy",
]);
export type WhisperErrorCode = z.infer<typeof WhisperErrorCode>;

/** Per-channel speaker label for stereo (meeting) transcription. */
export const WhisperSpeaker = z.enum(["you", "other"]);
export type WhisperSpeaker = z.infer<typeof WhisperSpeaker>;

/** A transcribed segment: start/end in seconds, trimmed text, optional speaker. */
export const WhisperSegment = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  speaker: WhisperSpeaker.optional(),
});
export type WhisperSegment = z.infer<typeof WhisperSegment>;

/** A catalog entry as surfaced to the settings model picker. */
export const WhisperModelSummary = z.object({
  id: z.string(),
  label: z.string(),
  sizeMb: z.number(),
  installed: z.boolean(),
  recommended: z.boolean(),
});
export type WhisperModelSummary = z.infer<typeof WhisperModelSummary>;

/** Result of the capability probe (RFC 009 §13). */
export const WhisperCapability = z.object({
  supported: z.boolean(),
  accel: WhisperAccel,
  cores: z.number(),
  reason: z.string().optional(),
});
export type WhisperCapability = z.infer<typeof WhisperCapability>;

/** Model-download progress event payload (`whisper:modelProgress`). */
export const WhisperModelProgress = z.object({
  id: z.string(),
  receivedMb: z.number(),
  totalMb: z.number(),
  phase: z.enum(["download", "verify"]),
});
export type WhisperModelProgress = z.infer<typeof WhisperModelProgress>;

/**
 * Persisted on-device engine settings (the `whisper` block of `transcription.json`).
 * `threads: null` → auto (`min(8, cores-1)`); unknown `model` falls back to the
 * catalog default at resolution time (RFC 009 Appendix J).
 */
export const WhisperSettings = z.object({
  model: z.string().default("base.en-q5_1"),
  language: z.string().default("en"),
  threads: z.number().int().positive().nullable().default(null),
  vad: z.boolean().default(true),
});
export type WhisperSettings = z.infer<typeof WhisperSettings>;

/** Fully-resolved default whisper settings (used as the nested object default). */
export const DEFAULT_WHISPER_SETTINGS: WhisperSettings = {
  model: "base.en-q5_1",
  language: "en",
  threads: null,
  vad: true,
};

/**
 * `~/.rowboat/config/transcription.json` (RFC 009 §12, Appendix J).
 *
 * Unknown fields are ignored (forward-compat). When the file is absent the main
 * process synthesizes defaults from the legacy cloud config + sign-in state
 * (back-compat, §36) — see `getTranscriptionConfig` in core.
 */
export const TranscriptionConfig = z.object({
  $schemaVersion: z.literal(1).default(1),
  voiceProvider: TranscriptionProvider.default("whisper-local"),
  meetingProvider: TranscriptionProvider.default("deepgram"),
  whisper: WhisperSettings.default(DEFAULT_WHISPER_SETTINGS),
});
export type TranscriptionConfig = z.infer<typeof TranscriptionConfig>;

/**
 * Remote, A/B-able fleet defaults carried on the per-user account payload
 * (RFC 009 §16/§25). User overrides in `transcription.json` win over these; these
 * win over the hardcoded fallback. Flipping `voiceProvider` back to a cloud value
 * is the kill switch (§Z.4).
 */
export const TranscriptionDefaults = z.object({
  voiceProvider: TranscriptionProvider.optional(),
  meetingProvider: TranscriptionProvider.optional(),
  freeMeetingMinutes: z.number().nonnegative().optional(),
});
export type TranscriptionDefaults = z.infer<typeof TranscriptionDefaults>;
