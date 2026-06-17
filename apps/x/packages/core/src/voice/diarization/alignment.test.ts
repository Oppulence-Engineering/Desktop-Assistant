import { describe, expect, it } from "vitest";
import { alignTranscriptToSpeakers, overlapMs, type DiarizationTurn } from "./alignment.js";

describe("overlapMs", () => {
  it("computes intersection length, 0 when disjoint", () => {
    expect(overlapMs(0, 100, 50, 150)).toBe(50);
    expect(overlapMs(0, 100, 100, 200)).toBe(0);
    expect(overlapMs(0, 100, 200, 300)).toBe(0);
  });
});

describe("alignTranscriptToSpeakers", () => {
  it("attributes a segment to the dominant overlapping turn", () => {
    const turns: DiarizationTurn[] = [
      { startMs: 0, endMs: 1000, speakerId: "spk_1", confidence: 0.9 },
    ];
    const out = alignTranscriptToSpeakers(
      [{ segmentId: "s1", text: "hello there", startMs: 100, endMs: 900 }],
      turns,
    );
    expect(out).toHaveLength(1);
    expect(out[0].speakerId).toBe("spk_1");
    expect(out[0].text).toBe("hello there");
    expect(out[0].provider).toBe("whisper.cpp");
  });

  it("preserves transcript text + timestamps when no turn overlaps (fail-safe)", () => {
    const out = alignTranscriptToSpeakers(
      [{ segmentId: "s1", text: "orphan words", startMs: 5000, endMs: 6000 }],
      [{ startMs: 0, endMs: 1000, speakerId: "spk_1", confidence: 1 }],
    );
    expect(out).toHaveLength(1);
    expect(out[0].speakerId).toBeUndefined();
    expect(out[0].text).toBe("orphan words");
    expect(out[0].startMs).toBe(5000);
  });

  it("splits a segment spanning two speakers using word timestamps", () => {
    const turns: DiarizationTurn[] = [
      { startMs: 0, endMs: 1000, speakerId: "spk_1", confidence: 0.9 },
      { startMs: 1000, endMs: 2000, speakerId: "spk_2", confidence: 0.9 },
    ];
    const out = alignTranscriptToSpeakers(
      [
        {
          segmentId: "s1",
          text: "hi there bye now",
          startMs: 0,
          endMs: 2000,
          words: [
            { text: "hi", startMs: 100, endMs: 300 },
            { text: "there", startMs: 300, endMs: 800 },
            { text: "bye", startMs: 1100, endMs: 1400 },
            { text: "now", startMs: 1400, endMs: 1900 },
          ],
        },
      ],
      turns,
    );
    expect(out).toHaveLength(2);
    expect(out[0].speakerId).toBe("spk_1");
    expect(out[0].text).toBe("hi there");
    expect(out[1].speakerId).toBe("spk_2");
    expect(out[1].text).toBe("bye now");
    expect(out[0].segmentId).toBe("s1.0");
    expect(out[1].segmentId).toBe("s1.1");
  });

  it("marks words with poor overlap as unknown (no false attribution)", () => {
    const turns: DiarizationTurn[] = [
      { startMs: 0, endMs: 500, speakerId: "spk_1", confidence: 0.9 },
      { startMs: 5000, endMs: 6000, speakerId: "spk_2", confidence: 0.9 },
    ];
    const out = alignTranscriptToSpeakers(
      [
        {
          segmentId: "s1",
          text: "clear gap",
          startMs: 0,
          endMs: 6000,
          words: [
            { text: "clear", startMs: 100, endMs: 400 }, // in spk_1
            { text: "gap", startMs: 2500, endMs: 2800 }, // in neither
          ],
        },
      ],
      turns,
    );
    const byText = Object.fromEntries(out.map((s) => [s.text, s]));
    expect(byText["clear"].speakerId).toBe("spk_1");
    expect(byText["gap"].speakerId).toBeUndefined();
  });
});
