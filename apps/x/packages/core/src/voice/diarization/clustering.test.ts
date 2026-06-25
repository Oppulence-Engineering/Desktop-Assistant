import { describe, expect, it } from "vitest";
import { OnlineSpeakerClusterer, cosineSimilarity, normalizeVector } from "./clustering.js";

/** A unit-ish vector pointing mostly along axis `k` with small jitter. */
function vec(dim: number, k: number, jitter = 0.05, seed = 1): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = ((i * seed) % 7) * jitter * 0.01;
  v[k] = 1;
  return v;
}

describe("cosineSimilarity / normalizeVector", () => {
  it("is 1 for identical, 0 for orthogonal", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it("handles zero vectors without NaN", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect([...normalizeVector([0, 0])]).toEqual([0, 0]);
  });
  it("normalizes to unit length", () => {
    const n = normalizeVector([3, 4]);
    expect(Math.hypot(n[0], n[1])).toBeCloseTo(1);
  });
});

describe("OnlineSpeakerClusterer", () => {
  const span = { startMs: 0, endMs: 1000 };

  it("groups similar embeddings into one speaker and separates distinct ones", () => {
    const c = new OnlineSpeakerClusterer();
    const a1 = c.assign(vec(8, 0, 0.02, 1), span);
    const a2 = c.assign(vec(8, 0, 0.02, 2), { startMs: 1000, endMs: 2000 });
    const b1 = c.assign(vec(8, 3, 0.02, 3), { startMs: 2000, endMs: 3000 });

    expect(a1.speakerId).toBeTruthy();
    expect(a2.speakerId).toBe(a1.speakerId); // same voice
    expect(b1.speakerId).toBeTruthy();
    expect(b1.speakerId).not.toBe(a1.speakerId); // different voice
    expect(c.speakerCount).toBe(2);
    expect(a1.displayName).toBe("Speaker 1");
    expect(b1.displayName).toBe("Speaker 2");
  });

  it("leaves a low-quality (overlap/short) segment unknown without polluting centroids", () => {
    const c = new OnlineSpeakerClusterer();
    c.assign(vec(8, 0), span);
    const lq = c.assign(vec(8, 5), { startMs: 1000, endMs: 1100 }, { lowQuality: true });
    expect(lq.speakerId).toBeNull();
    expect(lq.displayName).toBe("Unknown speaker");
    expect(lq.method).toBe("unknown");
    expect(c.speakerCount).toBe(1); // no new speaker created from a low-quality segment
  });

  it("prefers Unknown over over-splitting past maxSpeakers", () => {
    const c = new OnlineSpeakerClusterer({ maxSpeakers: 2 });
    c.assign(vec(8, 0), span);
    c.assign(vec(8, 2), span);
    const third = c.assign(vec(8, 4), span); // a genuinely new voice, but cap reached
    expect(third.speakerId).toBeNull();
    expect(c.speakerCount).toBe(2);
  });

  it("snapshot exposes opaque centroid refs, never raw vectors", () => {
    const c = new OnlineSpeakerClusterer();
    c.assign(vec(8, 0), span);
    const snap = c.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].embeddingCentroidRef).toMatch(/^centroid:/);
    expect(snap[0]).not.toHaveProperty("vector");
    expect(snap[0].segmentCount).toBe(1);
  });
});
