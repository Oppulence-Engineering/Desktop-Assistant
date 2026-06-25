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
export const TranscriptionProvider = z.enum(["solomon", "deepgram", "whisper-local", "none"]);
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

export const WhisperModelHealth = z.object({
  id: z.string(),
  installed: z.boolean(),
  ggufOk: z.boolean(),
  vadOk: z.boolean(),
  coremlOk: z.boolean().optional(),
  sizeMb: z.number(),
  expectedSizeMb: z.number().optional(),
  checksum: z.string().optional(),
  expectedChecksum: z.string().optional(),
  repairable: z.boolean(),
  reason: z.string().optional(),
});
export type WhisperModelHealth = z.infer<typeof WhisperModelHealth>;

export const WhisperBenchmarkProfile = z.object({
  deviceId: z.string(),
  model: z.string(),
  accel: WhisperAccel,
  sampleSeconds: z.number(),
  durationMs: z.number(),
  rtf: z.number(),
  measuredAt: z.string(),
});
export type WhisperBenchmarkProfile = z.infer<typeof WhisperBenchmarkProfile>;

export const VoicePrivacySettings = z.object({
  localOnly: z.boolean().default(false),
  retainRawAudio: z.boolean().default(false),
  retainDiagnostics: z.boolean().default(false),
  redactTranscriptsInLogs: z.boolean().default(true),
});
export type VoicePrivacySettings = z.infer<typeof VoicePrivacySettings>;

export const WhisperDiagnosticResult = z.object({
  success: z.boolean(),
  provider: TranscriptionProvider,
  model: z.string(),
  accel: WhisperAccel,
  sampleSeconds: z.number(),
  durationMs: z.number(),
  rtf: z.number().optional(),
  text: z.string().optional(),
  code: WhisperErrorCode.optional(),
  engineLog: z.string().optional(),
});
export type WhisperDiagnosticResult = z.infer<typeof WhisperDiagnosticResult>;

export const VoiceStreamEvent = z.discriminatedUnion("type", [
  z.object({
    v: z.literal(1),
    type: z.literal("partial"),
    text: z.string(),
    start: z.number(),
    end: z.number(),
    speaker: WhisperSpeaker.optional(),
    confidence: z.number().min(0).max(1).optional(),
  }),
  z.object({ v: z.literal(1), type: z.literal("final"), segment: WhisperSegment }),
  z.object({ v: z.literal(1), type: z.literal("ack"), seq: z.number(), credits: z.number() }),
  z.object({ v: z.literal(1), type: z.literal("error"), code: WhisperErrorCode }),
  z.object({ v: z.literal(1), type: z.literal("done") }),
]);
export type VoiceStreamEvent = z.infer<typeof VoiceStreamEvent>;

export const VoiceCommandIntent = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("email.composeReply"),
    threadId: z.string().optional(),
    body: z.string(),
  }),
  z.object({
    kind: z.literal("email.triage"),
    query: z.string().optional(),
    action: z.enum(["archive", "label", "snooze", "mark_waiting", "unsubscribe"]),
    label: z.string().optional(),
  }),
  z.object({ kind: z.literal("email.createRule"), description: z.string() }),
  z.object({ kind: z.literal("meeting.startRecording"), title: z.string().optional() }),
  z.object({ kind: z.literal("meeting.stopRecording") }),
  z.object({ kind: z.literal("app.openCommand"), query: z.string() }),
  z.object({ kind: z.literal("text.insert"), text: z.string() }),
]);
export type VoiceCommandIntent = z.infer<typeof VoiceCommandIntent>;

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
 * Persisted on-device diarization settings (the `diarization` block of
 * `transcription.json`, RFC 017). The four leading booleans mirror the RFC 017
 * rollback flags (LOCAL_DIARIZATION_*); the rest are clustering/VAD tunables that
 * are config-driven for fixture tuning but NOT exposed as normal user
 * preferences. Defined here (the config home) so `diarization.ts` can re-export
 * it without a circular import.
 */
export const DiarizationSettings = z.object({
  /** LOCAL_DIARIZATION_ENABLED — master switch for the local pipeline. */
  enabled: z.boolean().default(false),
  /** LOCAL_DIARIZATION_BETA_UI — shows the beta meeting mode + provenance UI. */
  betaUI: z.boolean().default(false),
  /** LOCAL_DIARIZATION_REFINEMENT — run a trailing re-clustering pass. */
  refinement: z.boolean().default(true),
  /** LOCAL_DIARIZATION_FIXTURE_MODE — deterministic embedder for fixtures/tests. */
  fixtureMode: z.boolean().default(false),
  /** Speaker-embedding model id (catalog). */
  model: z.string().default("speaker-embedding-v1"),
  /** Max speakers before requiring a manual split (over-split guard). */
  maxSpeakers: z.number().int().positive().default(8),
  /** Cosine similarity at/above which a segment joins an existing speaker. */
  similarityThreshold: z.number().min(0).max(1).default(0.65),
  /** Below this best-similarity, a segment is left `Unknown speaker`. */
  unknownThreshold: z.number().min(0).max(1).default(0.45),
  /** Weight of a new segment when updating a centroid (0..1). */
  centroidUpdateWeight: z.number().min(0).max(1).default(0.25),
  /** Minimum speech length (ms) to embed; shorter turns are left unknown. */
  minSegmentMs: z.number().int().positive().default(400),
  /** Treat overlap-heavy segments above this overlap ratio as unknown. */
  maxOverlapRatio: z.number().min(0).max(1).default(0.5),
});
export type DiarizationSettings = z.infer<typeof DiarizationSettings>;

/** Fully-resolved default diarization settings (off by default, v1). */
export const DEFAULT_DIARIZATION_SETTINGS: DiarizationSettings = {
  enabled: false,
  betaUI: false,
  refinement: true,
  fixtureMode: false,
  model: "speaker-embedding-v1",
  maxSpeakers: 8,
  similarityThreshold: 0.65,
  unknownThreshold: 0.45,
  centroidUpdateWeight: 0.25,
  minSegmentMs: 400,
  maxOverlapRatio: 0.5,
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
  privacy: VoicePrivacySettings.default({
    localOnly: false,
    retainRawAudio: false,
    retainDiagnostics: false,
    redactTranscriptsInLogs: true,
  }),
  // RFC 017: on-device meeting diarization (off by default, beta).
  diarization: DiarizationSettings.default(DEFAULT_DIARIZATION_SETTINGS),
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
  /** RFC 017 fleet default for the local-diarization beta (off unless enabled). */
  diarizationEnabled: z.boolean().optional(),
});
export type TranscriptionDefaults = z.infer<typeof TranscriptionDefaults>;
