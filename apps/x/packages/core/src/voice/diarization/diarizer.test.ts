import { describe, expect, it } from "vitest";
import { Diarizer } from "./diarizer.js";
import type { SpeakerEmbedder } from "./embedder.js";

/** Deterministic stub: the first PCM sample tags the speaker (orthogonal vectors). */
class StubEmbedder implements SpeakerEmbedder {
  readonly id = "stub-v1";
  readonly dim = 4;
  async embed(pcm: Int16Array): Promise<Float32Array> {
    const v = new Float32Array(this.dim);
    v[(((pcm[0] ?? 0) % this.dim) + this.dim) % this.dim] = 1;
    return v;
  }
}

const SR = 16000;
function pcm(tag: number, ms = 1000): Int16Array {
  const a = new Int16Array(Math.round((SR * ms) / 1000));
  a[0] = tag;
  return a;
}

function mk(sessionId = "s"): Diarizer {
  return new Diarizer({ sessionId, embedder: new StubEmbedder() });
}

describe("Diarizer", () => {
  it("assigns stable speakers across a meeting", async () => {
    const d = mk();
    const a1 = await d.addSegment({
      segmentId: "g0",
      startMs: 0,
      endMs: 1000,
      pcm: pcm(1),
      sampleRate: SR,
    });
    const b1 = await d.addSegment({
      segmentId: "g1",
      startMs: 1000,
      endMs: 2000,
      pcm: pcm(2),
      sampleRate: SR,
    });
    const a2 = await d.addSegment({
      segmentId: "g2",
      startMs: 2000,
      endMs: 3000,
      pcm: pcm(1),
      sampleRate: SR,
    });
    const b2 = await d.addSegment({
      segmentId: "g3",
      startMs: 3000,
      endMs: 4000,
      pcm: pcm(2),
      sampleRate: SR,
    });

    expect(a1.speakerId).toBe(a2.speakerId);
    expect(b1.speakerId).toBe(b2.speakerId);
    expect(a1.speakerId).not.toBe(b1.speakerId);
    expect(a1.displayName).toBe("Speaker 1");
    expect(b1.displayName).toBe("Speaker 2");
  });

  it("emits a serializable state with no raw embedding vectors", async () => {
    const d = mk();
    await d.addSegment({ segmentId: "g0", startMs: 0, endMs: 1000, pcm: pcm(1), sampleRate: SR });
    await d.addSegment({
      segmentId: "g1",
      startMs: 1000,
      endMs: 2000,
      pcm: pcm(2),
      sampleRate: SR,
    });
    const state = d.state();
    expect(state.sessionId).toBe("s");
    expect(state.modelVersion).toBe("stub-v1");
    expect(state.speakers).toHaveLength(2);
    expect(state.assignments).toHaveLength(2);
    for (const s of state.speakers) {
      expect(s.embeddingCentroidRef).toMatch(/^centroid:/);
      expect(JSON.stringify(s)).not.toContain("vector");
    }
  });

  it("leaves a too-short segment unknown", async () => {
    const d = mk();
    const t = await d.addSegment({
      segmentId: "g0",
      startMs: 0,
      endMs: 100,
      pcm: pcm(1, 100),
      sampleRate: SR,
    });
    expect(t.speakerId).toBeNull();
    expect(t.displayName).toBe("Unknown speaker");
  });

  it("leaves an overlap-heavy segment unknown", async () => {
    const d = mk();
    const t = await d.addSegment({
      segmentId: "g0",
      startMs: 0,
      endMs: 1000,
      pcm: pcm(1),
      sampleRate: SR,
      overlapRatio: 0.9,
    });
    expect(t.speakerId).toBeNull();
  });

  it("dispose clears embeddings so refinement has nothing to re-cluster", async () => {
    const d = mk();
    await d.addSegment({ segmentId: "g0", startMs: 0, endMs: 1000, pcm: pcm(1), sampleRate: SR });
    d.dispose();
    expect(d.refine()).toEqual([]);
  });

  it("turns() are time-ordered", async () => {
    const d = mk();
    await d.addSegment({
      segmentId: "g1",
      startMs: 1000,
      endMs: 2000,
      pcm: pcm(2),
      sampleRate: SR,
    });
    await d.addSegment({ segmentId: "g0", startMs: 0, endMs: 1000, pcm: pcm(1), sampleRate: SR });
    const turns = d.turns();
    expect(turns.map((t) => t.segmentId)).toEqual(["g0", "g1"]);
  });
});
