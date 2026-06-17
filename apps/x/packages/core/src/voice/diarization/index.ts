/**
 * On-device meeting diarization (RFC 017). Layers speaker attribution on top of
 * the RFC 009 local transcription pipeline. Everything here is pure/testable; the
 * native speaker-embedding model is injected by the main process (see
 * {@link createEmbedder}). v1 ships behind LOCAL_DIARIZATION_* flags, beta only.
 */
export {
  OnlineSpeakerClusterer,
  cosineSimilarity,
  normalizeVector,
  type ClusterAssignment,
  type ClustererTunables,
  type SpeakerSnapshot,
} from "./clustering.js";
export {
  alignTranscriptToSpeakers,
  overlapMs,
  type AlignmentOptions,
  type DiarizationTurn,
  type SttSegment,
} from "./alignment.js";
export {
  EnergyProfileEmbedder,
  NativeSpeakerEmbedder,
  createEmbedder,
  type CreateEmbedderOptions,
  type EmbedInfer,
  type SpeakerEmbedder,
} from "./embedder.js";
export {
  Diarizer,
  type DiarizerInput,
  type DiarizerOptions,
  type DiarizerTurn,
} from "./diarizer.js";
export {
  buildDiarizationProvenance,
  meetingDiarizationState,
  provenanceNoteHeader,
  provenanceToFrontmatter,
  type ProvenanceInput,
} from "./provenance.js";
export {
  diarizationActive,
  diarizationModeFor,
  parseEnvFlag,
  resolveDiarizationSettings,
} from "./config.js";
export {
  diarizationErrorRate,
  greedySpeakerMapping,
  jaccardErrorRate,
  parseRttm,
  speakerCountAccuracy,
  splitMergeRates,
  toRttm,
  unknownRate,
  type DerOptions,
  type DerResult,
  type LabeledTurn,
} from "./metrics.js";
export {
  buildFixtureReport,
  confusionMatrix,
  decodeWav,
  offlineVadSegments,
  runDiarizerOverPcm,
  turnsToLabeled,
  type FixtureReport,
  type OfflineSegment,
} from "./fixtures.js";
