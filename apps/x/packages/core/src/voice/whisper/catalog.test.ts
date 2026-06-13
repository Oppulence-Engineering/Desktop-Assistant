import { describe, expect, it } from "vitest";
import { CATALOG, VAD_MODEL_ID } from "./catalog.js";

describe("whisper catalog", () => {
  it("pins a checksum for every installable catalog entry", () => {
    expect(CATALOG.length).toBeGreaterThan(0);
    for (const model of CATALOG) {
      expect(model.sha256, `${model.id} should have a pinned checksum`).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("uses the upstream VAD model repository for Silero VAD", () => {
    const vad = CATALOG.find((model) => model.id === VAD_MODEL_ID);
    expect(vad?.url).toBe(
      "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin",
    );
  });

  it("catalogs pinned Core ML sidecar archives for downloadable macOS models", () => {
    for (const model of CATALOG.filter((entry) => entry.downloadable)) {
      expect(model.coreml?.url, `${model.id} should have a Core ML sidecar URL`).toMatch(
        /^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/main\/ggml-.+-encoder\.mlmodelc\.zip$/,
      );
      expect(model.coreml?.sha256, `${model.id} should have a pinned Core ML checksum`).toMatch(
        /^[a-f0-9]{64}$/,
      );
      expect(
        model.coreml?.sizeMb,
        `${model.id} should declare Core ML download size`,
      ).toBeGreaterThan(0);
      expect(
        model.coreml?.url,
        `${model.id} sidecar name should not include quant suffix`,
      ).not.toMatch(/-q[0-9]_[0-9]-encoder\.mlmodelc\.zip$/);
    }
  });
});
