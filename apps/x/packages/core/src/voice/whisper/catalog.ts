import type { LocalModelKind } from "@x/shared/diarization";
import { CHECKSUMS, COREML_CHECKSUMS, COREML_SIZES_MB } from "./checksums.js";

/**
 * Static whisper.cpp model catalog (RFC 009 §9, Appendix E).
 *
 * We expose only the quantized + recommended tiers, not every upstream variant.
 * Disk sizes are approximate (for the UI); the authoritative `sha256` for each
 * model is pinned in {@link CHECKSUMS} — captured from the whisper.cpp manifest
 * by `scripts/whisper-fetch-checksums.mjs`, **never hand-typed** (§9/§21). A model
 * with no pinned checksum is refused at download time rather than trusted blindly.
 */

/** Hugging Face source for the GGUF weights. */
const HF_REPO = "ggerganov/whisper.cpp";
/** Upstream whisper.cpp stores VAD models in a separate repository. */
const VAD_HF_REPO = "ggml-org/whisper-vad";
/**
 * Revision to resolve. `main` today; pin to an immutable commit for stronger
 * supply-chain guarantees (§21/§31 open question) without touching this file's shape.
 */
const HF_REVISION = "main";

function hfUrl(fileName: string, repo = HF_REPO): string {
  return `https://huggingface.co/${repo}/resolve/${HF_REVISION}/${fileName}`;
}

const COREML_MODEL_BY_ENTRY_ID: Record<string, string> = {
  "tiny.en-q5_1": "tiny.en",
  "base.en-q5_1": "base.en",
  "base-q5_1": "base",
  "small.en-q5_1": "small.en",
  "small-q5_1": "small",
  "large-v3-turbo-q5_0": "large-v3-turbo",
  "large-v3-q5_0": "large-v3",
};

function coremlSidecarFor(entryId: string): ModelEntry["coreml"] | undefined {
  const coremlId = COREML_MODEL_BY_ENTRY_ID[entryId];
  if (!coremlId) return undefined;
  return {
    url: hfUrl(`ggml-${coremlId}-encoder.mlmodelc.zip`),
    sha256: COREML_CHECKSUMS[coremlId] ?? "",
    sizeMb: COREML_SIZES_MB[coremlId] ?? 0,
  };
}

export type ModelFamily =
  | "tiny"
  | "base"
  | "small"
  | "large-v3"
  | "large-v3-turbo"
  | "vad"
  | "speaker-embedding";

export type ModelQuant = "f16" | "q5_0" | "q5_1" | "q8_0" | "none";

/** A single catalog entry. `sha256` is merged from {@link CHECKSUMS} at load time. */
export interface ModelEntry {
  /** Stable id used by config + IPC, e.g. `base.en-q5_1`. */
  id: string;
  /** Human label for the settings picker. */
  label: string;
  family: ModelFamily;
  /**
   * Asset kind (RFC 017). Defaults to `transcription`; the VAD model is `vad` and
   * the speaker-embedding model is `speaker_embedding`. The model manager gates
   * the whisper-only VAD-companion / Core ML logic on this so non-transcription
   * assets install and verify on their own.
   */
  kind: LocalModelKind;
  /** English-only (`.en`) vs multilingual. VAD is neither. */
  english: boolean;
  quant: ModelQuant;
  /** Approximate download size in MB (UI hint + disk guard). */
  sizeMb: number;
  /** Pinned SHA-256 of the `.bin`, or `''` when not yet captured. */
  sha256: string;
  /** Hugging Face resolve URL for the `.bin`. */
  url: string;
  /** Optional macOS Core ML encoder sidecar. */
  coreml?: { url: string; sha256: string; sizeMb: number };
  /** The recommended default model (one per locale family). */
  recommendedDefault?: boolean;
  /** Shown in the settings picker (VAD is auto, never listed). */
  downloadable: boolean;
}

/** The Silero VAD model id — always installed alongside the first local model. */
export const VAD_MODEL_ID = "silero-v5.1.2";
export const VAD_FILE_NAME = "ggml-silero-v5.1.2.bin";

/**
 * The speaker-embedding model id (RFC 017 §3) — installed on demand when local
 * diarization is enabled. Its checksum stays empty until captured, so (like every
 * model) an unverified download is refused.
 */
export const SPEAKER_EMBEDDING_MODEL_ID = "speaker-embedding-v1";
export const SPEAKER_EMBEDDING_FILE_NAME = "speaker-embedding-v1.onnx";
/** Upstream source for the exported ONNX speaker-embedding encoder. */
const SPEAKER_EMBEDDING_HF_REPO = "onnx-community/wespeaker-voxceleb-resnet34-LM";

/** Catalog metadata (sha256 filled in from {@link CHECKSUMS}; kind defaults to transcription). */
const ENTRIES: (Omit<ModelEntry, "sha256" | "kind"> & { kind?: LocalModelKind })[] = [
  {
    id: "tiny.en-q5_1",
    label: "Tiny · English",
    family: "tiny",
    english: true,
    quant: "q5_1",
    sizeMb: 31,
    url: hfUrl("ggml-tiny.en-q5_1.bin"),
    downloadable: true,
  },
  {
    id: "base.en-q5_1",
    label: "Base · English (recommended)",
    family: "base",
    english: true,
    quant: "q5_1",
    sizeMb: 57,
    url: hfUrl("ggml-base.en-q5_1.bin"),
    recommendedDefault: true,
    downloadable: true,
  },
  {
    id: "base-q5_1",
    label: "Base · Multilingual",
    family: "base",
    english: false,
    quant: "q5_1",
    sizeMb: 57,
    url: hfUrl("ggml-base-q5_1.bin"),
    downloadable: true,
  },
  {
    id: "small.en-q5_1",
    label: "Small · English",
    family: "small",
    english: true,
    quant: "q5_1",
    sizeMb: 182,
    url: hfUrl("ggml-small.en-q5_1.bin"),
    downloadable: true,
  },
  {
    id: "small-q5_1",
    label: "Small · Multilingual",
    family: "small",
    english: false,
    quant: "q5_1",
    sizeMb: 182,
    url: hfUrl("ggml-small-q5_1.bin"),
    downloadable: true,
  },
  {
    id: "large-v3-turbo-q5_0",
    label: "Large v3 Turbo · Multilingual (fast, accurate)",
    family: "large-v3-turbo",
    english: false,
    quant: "q5_0",
    sizeMb: 547,
    url: hfUrl("ggml-large-v3-turbo-q5_0.bin"),
    downloadable: true,
  },
  {
    id: "large-v3-q5_0",
    label: "Large v3 · Multilingual (max accuracy)",
    family: "large-v3",
    english: false,
    quant: "q5_0",
    sizeMb: 1100,
    url: hfUrl("ggml-large-v3-q5_0.bin"),
    downloadable: true,
  },
  {
    id: VAD_MODEL_ID,
    label: "Silero VAD",
    family: "vad",
    kind: "vad",
    english: false,
    quant: "none",
    sizeMb: 1,
    url: hfUrl(VAD_FILE_NAME, VAD_HF_REPO),
    downloadable: false,
  },
  {
    id: SPEAKER_EMBEDDING_MODEL_ID,
    label: "Speaker Embedding (beta)",
    family: "speaker-embedding",
    kind: "speaker_embedding",
    english: false,
    quant: "none",
    sizeMb: 26,
    url: hfUrl(SPEAKER_EMBEDDING_FILE_NAME, SPEAKER_EMBEDDING_HF_REPO),
    downloadable: false,
  },
];

/** The shippable catalog, with pinned checksums merged in. */
export const CATALOG: ModelEntry[] = ENTRIES.map((e) => ({
  ...e,
  kind: e.kind ?? "transcription",
  sha256: CHECKSUMS[e.id] ?? "",
  coreml: e.coreml ?? coremlSidecarFor(e.id),
}));

/** The default speaker-embedding model id for local diarization (RFC 017). */
export function defaultSpeakerEmbeddingId(): string {
  return SPEAKER_EMBEDDING_MODEL_ID;
}

export function findModel(id: string): ModelEntry | undefined {
  return CATALOG.find((m) => m.id === id);
}

/**
 * The default model id. English-first; a non-English app locale prefers the
 * multilingual base (§37). Falls back to the recommended entry or the first one.
 */
export function defaultModelId(locale?: string): string {
  const english = !locale || locale.toLowerCase().startsWith("en");
  if (!english) return "base-q5_1";
  const recommended = CATALOG.find((m) => m.recommendedDefault);
  return recommended?.id ?? "base.en-q5_1";
}
