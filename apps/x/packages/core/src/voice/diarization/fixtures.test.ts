import { describe, expect, it } from "vitest";
import {
  buildFixtureReport,
  decodeWav,
  offlineVadSegments,
  runDiarizerOverPcm,
} from "./fixtures.js";
import { pcm16ToWav } from "../whisper/wav.js";
import type { DiarizerTurn } from "./diarizer.js";

const SR = 16000;
function tone(freqHz: number, ms: number, amp = 0.4): Int16Array {
  const n = Math.round((SR * ms) / 1000);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++)
    out[i] = Math.round(Math.sin((2 * Math.PI * freqHz * i) / SR) * amp * 32767);
  return out;
}
function silence(ms: number): Int16Array {
  return new Int16Array(Math.round((SR * ms) / 1000));
}
function concat(...arrs: Int16Array[]): Int16Array {
  const len = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Int16Array(len);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

describe("decodeWav", () => {
  it("round-trips a pcm16 mono WAV", () => {
    const pcm = tone(300, 50);
    const wav = pcm16ToWav(pcm.buffer, { sampleRate: SR, channels: 1 });
    const decoded = decodeWav(wav);
    expect(decoded.sampleRate).toBe(SR);
    expect(decoded.channels).toBe(1);
    expect(decoded.pcm.length).toBe(pcm.length);
    expect([...decoded.pcm.slice(0, 8)]).toEqual([...pcm.slice(0, 8)]);
  });

  it("rejects non-WAVE input", () => {
    expect(() => decodeWav(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});

describe("offlineVadSegments", () => {
  it("splits speech regions separated by silence", () => {
    const audio = concat(tone(220, 600), silence(500), tone(220, 600));
    const segs = offlineVadSegments(audio, SR);
    expect(segs.length).toBe(2);
    expect(segs[0].startMs).toBeLessThan(segs[0].endMs);
    expect(segs[1].startMs).toBeGreaterThan(segs[0].endMs);
  });

  it("returns nothing for pure silence", () => {
    expect(offlineVadSegments(silence(1000), SR)).toEqual([]);
  });
});

describe("runDiarizerOverPcm", () => {
  it("produces speaker turns end-to-end with the deterministic embedder", async () => {
    const audio = concat(tone(150, 800), silence(400), tone(1500, 800));
    const { turns, state, elapsedMs } = await runDiarizerOverPcm(
      audio,
      SR,
      { fixtureMode: true },
      () => 0,
    );
    expect(turns.length).toBeGreaterThanOrEqual(2);
    expect(state.modelVersion).toBeTruthy();
    expect(typeof elapsedMs).toBe("number");
  });
});

describe("buildFixtureReport", () => {
  it("assembles DER + component metrics from a hypothesis", () => {
    const reference = [
      { startMs: 0, endMs: 1000, speakerId: "A" },
      { startMs: 1000, endMs: 2000, speakerId: "B" },
    ];
    const hypothesisTurns: DiarizerTurn[] = [
      {
        segmentId: "s0",
        startMs: 0,
        endMs: 1000,
        speakerId: "spk_1",
        displayName: "Speaker 1",
        confidence: 0.9,
        method: "embedding_cluster",
      },
      {
        segmentId: "s1",
        startMs: 1000,
        endMs: 2000,
        speakerId: "spk_2",
        displayName: "Speaker 2",
        confidence: 0.9,
        method: "embedding_cluster",
      },
    ];
    const report = buildFixtureReport({
      dataset: { name: "two_speakers.wav", category: "two_speakers" },
      reference,
      hypothesisTurns,
      elapsedMs: 120,
      audioDurationMs: 2000,
    });
    expect(report.der.der).toBeCloseTo(0);
    expect(report.speakerCount).toEqual({ refSpeakers: 2, hypSpeakers: 2, error: 0 });
    expect(report.timing.realTimeFactor).toBeCloseTo(0.06);
    expect(report.dataset.category).toBe("two_speakers");
    expect(Object.keys(report.confusion).length).toBeGreaterThan(0);
  });
});
