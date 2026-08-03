import { z } from "zod";
import { DEFAULT_MEETINGS_SETTINGS, MeetingsSettings } from "./meetings.js";

// Re-exported so consumers of the transcription config can reach the nested block
// without also importing ./meetings.js.
export { MeetingsSettings, DEFAULT_MEETINGS_SETTINGS };

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

/** App-aware, on-device formatting for system-wide desktop dictation. */
export const DictationAppCategory = z.enum([
  "email",
  "work-messaging",
  "personal-messaging",
  "other",
]);
export type DictationAppCategory = z.infer<typeof DictationAppCategory>;

export const DictationStyle = z.enum(["formal", "casual", "very-casual", "excited"]);
export type DictationStyle = z.infer<typeof DictationStyle>;

export const DictationStyleSettings = z.object({
  email: DictationStyle.default("formal"),
  workMessaging: DictationStyle.default("casual"),
  personalMessaging: DictationStyle.default("casual"),
  other: DictationStyle.default("formal"),
});
export type DictationStyleSettings = z.infer<typeof DictationStyleSettings>;

export const DEFAULT_DICTATION_STYLE_SETTINGS: DictationStyleSettings = {
  email: "formal",
  workMessaging: "casual",
  personalMessaging: "casual",
  other: "formal",
};

/** Native macOS hold-to-talk chord. Control+Option remains the migration-safe default. */
export const DictationShortcut = z.enum(["control-option", "fn", "control-fn"]);
export type DictationShortcut = z.infer<typeof DictationShortcut>;

export const DICTATION_SHORTCUT_LABELS: Record<DictationShortcut, string> = {
  "control-option": "Control + Option",
  fn: "Fn",
  "control-fn": "Control + Fn",
};

/** Screen edge where the always-on-top desktop dictation status bar is docked. */
export const DictationFlowBarDock = z.enum(["bottom", "left", "right"]);
export type DictationFlowBarDock = z.infer<typeof DictationFlowBarDock>;

/** Opt-in one-keystroke selection transforms, matching the available Mac slots. */
export const DictationTransformShortcut = z.enum([
  "option-1",
  "option-2",
  "option-3",
  "option-4",
  "option-5",
  "option-6",
  "option-7",
  "option-8",
  "option-9",
]);
export type DictationTransformShortcut = z.infer<typeof DictationTransformShortcut>;

export const DICTATION_TRANSFORM_SHORTCUT_LABELS: Record<DictationTransformShortcut, string> = {
  "option-1": "Option + 1",
  "option-2": "Option + 2",
  "option-3": "Option + 3",
  "option-4": "Option + 4",
  "option-5": "Option + 5",
  "option-6": "Option + 6",
  "option-7": "Option + 7",
  "option-8": "Option + 8",
  "option-9": "Option + 9",
};

export const DICTATION_TRANSFORM_SHORTCUT_OPTIONS = DictationTransformShortcut.options.map(
  (value) => ({ value, label: DICTATION_TRANSFORM_SHORTCUT_LABELS[value] }),
);

export const DictationTransform = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(60),
  instruction: z.string().trim().min(1).max(2_000),
  shortcut: DictationTransformShortcut,
});
export type DictationTransform = z.infer<typeof DictationTransform>;

export const DEFAULT_DICTATION_TRANSFORMS: DictationTransform[] = [
  {
    id: "polish",
    name: "Polish",
    instruction:
      "Fix grammar and spelling, improve clarity and readability, add useful structure, and preserve the original meaning, tone, names, technical terms, and URLs.",
    shortcut: "option-1",
  },
  {
    id: "prompt-engineer",
    name: "Prompt Engineer",
    instruction:
      "Rewrite this as a precise, well-structured prompt for an AI assistant. Preserve every requirement, constraint, and concrete detail.",
    shortcut: "option-2",
  },
];

/** Languages supported by the resident Parakeet v3 desktop-dictation model. */
export const DICTATION_LANGUAGE_CODES = [
  "auto",
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "ro",
  "nl",
  "da",
  "sv",
  "fi",
  "hu",
  "et",
  "lv",
  "lt",
  "mt",
  "pl",
  "cs",
  "sk",
  "sl",
  "hr",
  "bs",
  "ru",
  "uk",
  "be",
  "bg",
  "sr",
  "el",
] as const;

export const DictationLanguage = z.enum(DICTATION_LANGUAGE_CODES);
export type DictationLanguage = z.infer<typeof DictationLanguage>;

export const DICTATION_LANGUAGE_LABELS: Record<DictationLanguage, string> = {
  auto: "Auto-detect",
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  pt: "Português",
  ro: "Română",
  nl: "Nederlands",
  da: "Dansk",
  sv: "Svenska",
  fi: "Suomi",
  hu: "Magyar",
  et: "Eesti",
  lv: "Latviešu",
  lt: "Lietuvių",
  mt: "Malti",
  pl: "Polski",
  cs: "Čeština",
  sk: "Slovenčina",
  sl: "Slovenščina",
  hr: "Hrvatski",
  bs: "Bosanski",
  ru: "Русский",
  uk: "Українська",
  be: "Беларуская",
  bg: "Български",
  sr: "Српски",
  el: "Ελληνικά",
};

export const DICTATION_LANGUAGE_OPTIONS = DICTATION_LANGUAGE_CODES.map((value) => ({
  value,
  label: DICTATION_LANGUAGE_LABELS[value],
}));

/** A correct word/phrase plus an optional spelling the recognizer commonly returns. */
export const DictationDictionaryEntry = z.object({
  term: z.string().trim().min(1).max(60),
  replacementFor: z.string().trim().min(1).max(60).optional(),
  starred: z.boolean().default(false),
});
export type DictationDictionaryEntry = z.infer<typeof DictationDictionaryEntry>;

/** Spoken trigger → exact local expansion. Plain text is intentionally portable. */
export const DictationSnippet = z.object({
  trigger: z.string().trim().min(1).max(60),
  expansion: z.string().min(1).max(4_000),
});
export type DictationSnippet = z.infer<typeof DictationSnippet>;

/** Stable browser media-device identity retained locally so disconnected mics stay ranked. */
export const DictationMicrophonePreference = z.object({
  deviceId: z.string().trim().min(1).max(512),
  label: z.string().trim().min(1).max(200),
});
export type DictationMicrophonePreference = z.infer<typeof DictationMicrophonePreference>;

/** How much successful desktop-dictation history is retained on this Mac. */
export const DictationHistoryRetention = z.enum(["forever", "24-hours", "never"]);
export type DictationHistoryRetention = z.infer<typeof DictationHistoryRetention>;

export const DictationHistoryStatus = z.enum(["success", "failed"]);
export type DictationHistoryStatus = z.infer<typeof DictationHistoryStatus>;

export const DictationHistoryEngine = z.enum([
  "parakeet",
  "whisper",
  "solomon",
  "deepgram",
  "unknown",
]);
export type DictationHistoryEngine = z.infer<typeof DictationHistoryEngine>;

/** Auditable, deterministic transforms applied after speech recognition. */
export const DictationPolishChange = z.enum([
  "press-enter",
  "fillers",
  "backtrack",
  "brevity",
  "formatting",
  "dictionary",
  "snippet",
  "context",
  "style",
]);
export type DictationPolishChange = z.infer<typeof DictationPolishChange>;

/** One privacy-bounded, local-only desktop dictation record. Raw audio is separate. */
export const DictationHistoryEntry = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  /** Currently selected history representation (formatted or restored raw text). */
  text: z.string().max(50_000),
  /** Exact normalized ASR output. Kept only under the transcript-retention policy. */
  rawText: z.string().max(50_000).optional(),
  /** Formatted output retained so Undo AI edit can be reversed losslessly. */
  polishedText: z.string().max(50_000).optional(),
  polishChanges: z.array(DictationPolishChange).default([]),
  formattingUndone: z.boolean().default(false),
  status: DictationHistoryStatus,
  delivery: z.enum(["pasted", "copied", "none"]),
  appName: z.string().trim().min(1).max(200).optional(),
  bundleIdentifier: z.string().trim().min(1).max(300).optional(),
  engine: DictationHistoryEngine,
  language: DictationLanguage.optional(),
  audioDurationMs: z
    .number()
    .nonnegative()
    .max(20 * 60 * 1_000),
  transcriptionDurationMs: z
    .number()
    .nonnegative()
    .max(20 * 60 * 1_000)
    .optional(),
  wordCount: z.number().int().nonnegative(),
  errorCode: z.string().trim().min(1).max(100).optional(),
  /** Response-only capability derived from the separately retained 14-day audio item. */
  retryAvailable: z.boolean().optional(),
});
export type DictationHistoryEntry = z.infer<typeof DictationHistoryEntry>;

export const DictationHistoryStats = z.object({
  totalWords: z.number().int().nonnegative(),
  todayWords: z.number().int().nonnegative(),
  averageWpm: z.number().nonnegative(),
  streakDays: z.number().int().nonnegative(),
  daysUsed: z.number().int().nonnegative(),
  totalDictations: z.number().int().nonnegative(),
  totalAudioDurationMs: z.number().nonnegative(),
  automaticallyEditedDictations: z.number().int().nonnegative(),
  wordsCleanedUp: z.number().int().nonnegative(),
  topApps: z.array(
    z.object({ appName: z.string().min(1).max(200), dictations: z.number().int().positive() }),
  ),
});
export type DictationHistoryStats = z.infer<typeof DictationHistoryStats>;

/** How strongly local post-processing may edit a desktop dictation. */
export const DictationCleanupLevel = z.enum(["none", "light", "medium", "high"]);
export type DictationCleanupLevel = z.infer<typeof DictationCleanupLevel>;

export const DictationSettings = z.object({
  shortcut: DictationShortcut.default("control-option"),
  /** Persisted edge for the draggable desktop dictation status bar. */
  flowBarDock: DictationFlowBarDock.default("bottom"),
  /** Keeps the compact click-to-dictate bubble visible between recordings. */
  showFlowBar: z.boolean().default(false),
  /** Transform shortcuts stay unregistered until the user explicitly opts in. */
  transformsEnabled: z.boolean().default(false),
  transforms: z.array(DictationTransform).max(9).default(DEFAULT_DICTATION_TRANSFORMS),
  /** One language per capture; auto asks the active engine to detect it. */
  language: DictationLanguage.default("auto"),
  /** Enables selection-aware voice commands on Command + Control + Option. */
  commandModeEnabled: z.boolean().default(true),
  /** Keeps only failed 16 kHz PCM locally for up to 14 days so it can be retried. */
  retryFailedAudio: z.boolean().default(true),
  /** Transcript history remains local and can be disabled or limited to the last day. */
  historyRetention: DictationHistoryRetention.default("forever"),
  /** Reads only nearby focused-textbox text; screenshots and full-window text are excluded. */
  contextEnabled: z.boolean().default(true),
  /** None preserves ASR text; stronger levels progressively add clarity and brevity edits. */
  cleanupLevel: DictationCleanupLevel.default("medium"),
  /** Highest available device wins; an empty list follows the macOS system default. */
  microphonePriority: z.array(DictationMicrophonePreference).max(32).default([]),
  styles: DictationStyleSettings.default(DEFAULT_DICTATION_STYLE_SETTINGS),
  dictionary: z.array(DictationDictionaryEntry).max(1_000).default([]),
  snippets: z.array(DictationSnippet).max(1_000).default([]),
});
export type DictationSettings = z.infer<typeof DictationSettings>;

export const DEFAULT_DICTATION_SETTINGS: DictationSettings = {
  shortcut: "control-option",
  flowBarDock: "bottom",
  showFlowBar: false,
  transformsEnabled: false,
  transforms: DEFAULT_DICTATION_TRANSFORMS,
  language: "auto",
  commandModeEnabled: true,
  retryFailedAudio: true,
  historyRetention: "forever",
  contextEnabled: true,
  cleanupLevel: "medium",
  microphonePriority: [],
  styles: DEFAULT_DICTATION_STYLE_SETTINGS,
  dictionary: [],
  snippets: [],
};

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
  // System-wide dictation personalization. Context is read and processed locally.
  dictation: DictationSettings.default(DEFAULT_DICTATION_SETTINGS),
  // RFC 017: on-device meeting diarization (off by default, beta).
  diarization: DiarizationSettings.default(DEFAULT_DIARIZATION_SETTINGS),
  // Native dual-track meeting capture: engine choice, echo cancellation, retention.
  meetings: MeetingsSettings.default(DEFAULT_MEETINGS_SETTINGS),
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

// ---------------------------------------------------------------------------
// Effective data routing
// ---------------------------------------------------------------------------

/**
 * Where a piece of speech or transcript text is processed.
 *
 * `unknown` is deliberately distinct from `cloud`: an OpenAI-compatible endpoint can
 * be local or remote, and privacy UI must not claim either without enough evidence.
 */
export const TranscriptionDataLocation = z.enum(["device", "cloud", "unavailable", "unknown"]);
export type TranscriptionDataLocation = z.infer<typeof TranscriptionDataLocation>;

/**
 * The route a feature will actually use, not merely the persisted preference.
 *
 * `configuredProvider` is retained so the UI can explain an override (for example,
 * local-only mode or native meeting capture). `cloudAllowedByUser` means the effective
 * cloud route comes from a cloud option that is enabled in settings; it is never true
 * while local-only mode is active.
 */
export const EffectiveTranscriptionRoute = z.object({
  configuredProvider: TranscriptionProvider,
  effectiveProvider: TranscriptionProvider,
  location: TranscriptionDataLocation,
  audioLeavesDevice: z.boolean(),
  cloudAllowedByUser: z.boolean(),
  reason: z.string().optional(),
  engine: z.string().optional(),
});
export type EffectiveTranscriptionRoute = z.infer<typeof EffectiveTranscriptionRoute>;

/** Text-only model work performed after speech-to-text. */
export const TranscriptEnrichmentRoute = z.object({
  provider: z.string(),
  model: z.string(),
  location: TranscriptionDataLocation,
  transcriptTextMayLeaveDevice: z.boolean(),
  summariesEnabled: z.boolean(),
  commitmentsEnabled: z.boolean(),
  liveQuestionsEnabled: z.boolean(),
});
export type TranscriptEnrichmentRoute = z.infer<typeof TranscriptEnrichmentRoute>;

/** Optional publication of transcript evidence into shared relationship state. */
export const RelationshipEvidenceRoute = z.object({
  enabled: z.boolean(),
  location: TranscriptionDataLocation,
  transcriptTextMayLeaveDevice: z.boolean(),
  destination: z.string(),
});
export type RelationshipEvidenceRoute = z.infer<typeof RelationshipEvidenceRoute>;

/**
 * One truthful receipt for every transcription-adjacent desktop surface.
 *
 * Voice memos intentionally share the voice route. Keeping a separate route in this
 * response makes that product promise independently visible and guards against a future
 * legacy implementation silently bypassing it again.
 */
export const TranscriptionRouting = z.object({
  localOnly: z.boolean(),
  voice: EffectiveTranscriptionRoute,
  voiceMemo: EffectiveTranscriptionRoute,
  meeting: EffectiveTranscriptionRoute.extend({
    captureEngine: z.enum(["native", "renderer"]),
  }),
  enrichment: TranscriptEnrichmentRoute,
  relationshipEvidence: RelationshipEvidenceRoute,
});
export type TranscriptionRouting = z.infer<typeof TranscriptionRouting>;
