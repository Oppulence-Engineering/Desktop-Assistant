/**
 * Local on-device transcription engine (whisper.cpp) — RFC 009.
 *
 * The main process imports {@link WhisperService} (the facade) and
 * {@link configureWhisperBinary} (to inject the packaged binary path). Everything
 * else is internal to the engine.
 */
export { WhisperService } from "./service.js";
export { pcmStats, timeoutFor, transcribePcm } from "./runner.js";
export type {
  TranscribeOpts,
  TranscribeResult,
  ModelProgress,
  WhisperPcmRunner,
} from "./service.js";
export type { PcmStats, RunOpts, RunResult, Segment } from "./runner.js";
export { configureWhisperBinary, binaryAvailable, binaryPath, vadModelPath } from "./bin.js";
export { probe as probeCapability, resetCapabilityCache } from "./capability.js";
export {
  CATALOG,
  defaultModelId,
  defaultSpeakerEmbeddingId,
  findModel,
  SPEAKER_EMBEDDING_MODEL_ID,
  VAD_MODEL_ID,
} from "./catalog.js";
export type { ModelEntry } from "./catalog.js";
export { WhisperError, codeOf } from "./errors.js";
export type { WhisperErrorCode } from "./errors.js";
export { wer, normalize as normalizeForWer } from "./wer.js";
export { isNonSpeech } from "./non-speech.js";
export type { StreamPort } from "./streaming.js";
