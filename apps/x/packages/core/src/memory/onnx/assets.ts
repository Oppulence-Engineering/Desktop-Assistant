// Model assets for on-device embeddings: pinned, checksum-verified, downloaded
// once into WorkDir.
//
// Same integrity rule as the whisper model manager (RFC 009 §9): bytes only
// reach their install path after matching a checksum pinned here. Weights are
// not arbitrary code, but a corrupted or substituted model silently produces
// vectors that rank the user's own notes wrongly — a failure with no symptom.
//
// Checksums below were produced by downloading these exact files and hashing
// them. Re-pin by doing the same; never copy a digest from a model card.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { WorkDir } from "../../config/config.js";

export interface AssetFile {
  name: string;
  url: string;
  sha256: string;
  bytes: number;
}

export interface EmbedModelSpec {
  /** Manifest identity. Namespaced so the index records which backend made the vectors. */
  id: string;
  dims: number;
  /** Cap on input tokens per chunk; the model's position embeddings stop at 512. */
  maxTokens: number;
  files: AssetFile[];
}

const HF = "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main";

/**
 * all-MiniLM-L6-v2, int8-quantized: 384 dims, 23MB, and symmetric — it needs no
 * "represent this sentence for search" prefix on queries.
 *
 * That last point is why it beats the nominally stronger bge-small here. Our
 * embed interface takes texts, not (query | document) roles, so an asymmetric
 * model would be fed unprefixed queries and quietly lose most of the advantage
 * it was chosen for.
 */
export const MINILM: EmbedModelSpec = {
  id: "local/all-MiniLM-L6-v2",
  dims: 384,
  maxTokens: 256,
  files: [
    {
      name: "model.onnx",
      url: `${HF}/onnx/model_quantized.onnx`,
      sha256: "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1",
      bytes: 22_972_370,
    },
    {
      name: "vocab.txt",
      url: `${HF}/vocab.txt`,
      sha256: "07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3",
      bytes: 231_508,
    },
  ],
};

export function modelDir(spec: EmbedModelSpec = MINILM): string {
  return path.join(WorkDir, "models", "embeddings", spec.id.replace("/", "_"));
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** True when every file of `spec` is already installed. */
export async function assetsInstalled(spec: EmbedModelSpec = MINILM): Promise<boolean> {
  const dir = modelDir(spec);
  for (const file of spec.files) {
    if (!(await exists(path.join(dir, file.name)))) return false;
  }
  return true;
}

async function downloadVerified(file: AssetFile, dest: string): Promise<void> {
  const tmp = `${dest}.part-${process.pid}`;
  try {
    const res = await fetch(file.url);
    if (!res.ok || !res.body) throw new Error(`${file.name} → ${res.status}`);

    const hash = createHash("sha256");
    const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    body.on("data", (chunk: Buffer) => hash.update(chunk));
    await pipeline(body, createWriteStream(tmp));

    const actual = hash.digest("hex");
    // An empty pin means "not yet pinned" — refuse rather than trust the wire.
    // Leaving this open would make the checksum decorative.
    if (!file.sha256) {
      throw new Error(`${file.name} has no pinned checksum (got ${actual})`);
    }
    if (actual !== file.sha256) {
      throw new Error(`${file.name} checksum mismatch: got ${actual}, want ${file.sha256}`);
    }
    // Rename last: a partial file must never be visible under its real name,
    // or the next run treats a truncated model as installed.
    await fs.rename(tmp, dest);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

let installInFlight: Promise<boolean> | null = null;

/**
 * Fetch any missing assets. Single-flight, and never throws — a model we could
 * not install is a degraded mode (the hosted provider still works), not an
 * error the user has to act on.
 *
 * @returns true when every file is present and verified.
 */
export async function installAssets(spec: EmbedModelSpec = MINILM): Promise<boolean> {
  if (installInFlight) return installInFlight;
  installInFlight = (async () => {
    const dir = modelDir(spec);
    try {
      await fs.mkdir(dir, { recursive: true });
      for (const file of spec.files) {
        const dest = path.join(dir, file.name);
        if (await exists(dest)) continue;
        console.log(`[Memory] Fetching on-device embedding asset ${file.name}…`);
        await downloadVerified(file, dest);
      }
      console.log("[Memory] On-device embedding model ready.");
      return true;
    } catch (error) {
      console.log(
        "[Memory] Could not install the on-device embedding model:",
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  })().finally(() => {
    installInFlight = null;
  });
  return installInFlight;
}
