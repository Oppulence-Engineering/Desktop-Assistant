import { CHECKSUMS } from "./checksums.js";

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
/**
 * Revision to resolve. `main` today; pin to an immutable commit for stronger
 * supply-chain guarantees (§21/§31 open question) without touching this file's shape.
 */
const HF_REVISION = "main";

function hfUrl(fileName: string): string {
  return `https://huggingface.co/${HF_REPO}/resolve/${HF_REVISION}/${fileName}`;
}

export type ModelFamily = "tiny" | "base" | "small" | "large-v3" | "large-v3-turbo" | "vad";

export type ModelQuant = "f16" | "q5_0" | "q5_1" | "q8_0" | "none";

/** A single catalog entry. `sha256` is merged from {@link CHECKSUMS} at load time. */
export interface ModelEntry {
  /** Stable id used by config + IPC, e.g. `base.en-q5_1`. */
  id: string;
  /** Human label for the settings picker. */
  label: string;
  family: ModelFamily;
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
  coreml?: { url: string; sha256: string };
  /** The recommended default model (one per locale family). */
  recommendedDefault?: boolean;
  /** Shown in the settings picker (VAD is auto, never listed). */
  downloadable: boolean;
}

/** The Silero VAD model id — always installed alongside the first local model. */
export const VAD_MODEL_ID = "silero-v5.1.2";
export const VAD_FILE_NAME = "ggml-silero-v5.1.2.bin";

/** Catalog metadata (sha256 filled in from {@link CHECKSUMS}). */
const ENTRIES: Omit<ModelEntry, "sha256">[] = [
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
    english: false,
    quant: "none",
    sizeMb: 1,
    url: hfUrl(VAD_FILE_NAME),
    downloadable: false,
  },
];

/** The shippable catalog, with pinned checksums merged in. */
export const CATALOG: ModelEntry[] = ENTRIES.map((e) => ({
  ...e,
  sha256: CHECKSUMS[e.id] ?? "",
}));

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
