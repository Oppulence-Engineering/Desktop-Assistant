import { describe, expect, it } from "vitest";
import { EnergyProfileEmbedder, NativeSpeakerEmbedder, createEmbedder } from "./embedder.js";
import { cosineSimilarity } from "./clustering.js";

const SR = 16000;
function tone(freqHz: number, ms: number, amp = 0.3): Int16Array {
  const n = Math.round((SR * ms) / 1000);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++)
    out[i] = Math.round(Math.sin((2 * Math.PI * freqHz * i) / SR) * amp * 32767);
  return out;
}

describe("EnergyProfileEmbedder", () => {
  it("is deterministic for identical input", async () => {
    const e = new EnergyProfileEmbedder();
    const pcm = tone(220, 600);
    const a = await e.embed(pcm, SR);
    const b = await e.embed(pcm, SR);
    expect([...a]).toEqual([...b]);
    expect(a.length).toBe(e.dim);
  });

  it("separates clearly distinct voices and matches same-pitch audio", async () => {
    const e = new EnergyProfileEmbedder();
    const low = await e.embed(tone(150, 600), SR);
    const lowAgain = await e.embed(tone(150, 800, 0.25), SR); // same pitch, diff length/amp
    const high = await e.embed(tone(1200, 600), SR);
    expect(cosineSimilarity(low, lowAgain)).toBeGreaterThan(cosineSimilarity(low, high));
  });

  it("returns a zero vector for empty PCM", async () => {
    const e = new EnergyProfileEmbedder();
    const v = await e.embed(new Int16Array(0), SR);
    expect([...v]).toEqual(new Array(e.dim).fill(0));
  });
});

describe("createEmbedder", () => {
  it("uses the deterministic embedder in fixture mode", () => {
    const e = createEmbedder({ fixtureMode: true, modelId: "x" });
    expect(e).toBeInstanceOf(EnergyProfileEmbedder);
  });

  it("uses the native embedder when provided and not in fixture mode", () => {
    const e = createEmbedder({
      native: { infer: async () => new Float32Array(3), dim: 3 },
      modelId: "speaker-embedding-v1",
    });
    expect(e).toBeInstanceOf(NativeSpeakerEmbedder);
    expect(e.id).toBe("speaker-embedding-v1");
    expect(e.dim).toBe(3);
  });

  it("falls back to deterministic when native is present but fixture mode forces it", () => {
    const e = createEmbedder({
      fixtureMode: true,
      native: { infer: async () => new Float32Array(3), dim: 3 },
    });
    expect(e).toBeInstanceOf(EnergyProfileEmbedder);
  });
});
