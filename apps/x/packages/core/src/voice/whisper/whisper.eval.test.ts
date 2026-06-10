import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./runner.js";
import { wer } from "./wer.js";
import { binaryAvailable } from "./bin.js";

/**
 * WER regression harness (RFC 009 §27, Appendix V). Runs the committed eval
 * corpus through the real engine and asserts per-bucket WER stays within budget,
 * catching a model/binary regression.
 *
 * Skipped unless both (a) a whisper-cli is available (`ROWBOAT_WHISPER_BIN`) and
 * (b) the corpus is non-empty — so it never blocks CI before the corpus lands.
 * Point `ROWBOAT_WHISPER_EVAL_MODEL` at a downloaded model to run it.
 */

interface Clip {
  id: string;
  wav: string;
  ref: string;
  bucket: string;
  lang?: string;
}

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "asr");

// Per-bucket WER budgets (regression gate).
const BUDGET: Record<string, number> = { clean: 0.1, noisy: 0.28, accented: 0.22, numbers: 0.2 };

async function loadManifest(): Promise<Clip[]> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(FIXTURES_DIR, "manifest.json"), "utf8"),
    ) as Clip[];
  } catch {
    return [];
  }
}

const modelPath = process.env.ROWBOAT_WHISPER_EVAL_MODEL;
const canRun = binaryAvailable() && !!modelPath;

describe.skipIf(!canRun)("whisper WER eval", () => {
  let manifest: Clip[] = [];
  beforeAll(async () => {
    manifest = await loadManifest();
  });

  it("stays within the per-bucket WER budget", async () => {
    if (manifest.length === 0) return; // empty corpus → nothing to assert

    const byBucket: Record<string, number[]> = {};
    for (const clip of manifest) {
      const { text } = await run(path.join(FIXTURES_DIR, clip.wav), {
        modelPath: modelPath!,
        lang: clip.lang ?? "en",
        audioSeconds: 15,
      });
      (byBucket[clip.bucket] ??= []).push(wer(clip.ref, text));
    }

    for (const [bucket, scores] of Object.entries(byBucket)) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      expect(avg).toBeLessThanOrEqual(BUDGET[bucket] ?? 0.3);
    }
  });
});
