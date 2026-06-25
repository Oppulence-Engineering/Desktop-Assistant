import { describe, expect, it } from "vitest";
import {
  diarizationErrorRate,
  jaccardErrorRate,
  parseRttm,
  speakerCountAccuracy,
  splitMergeRates,
  toRttm,
  unknownRate,
  type LabeledTurn,
} from "./metrics.js";

describe("diarizationErrorRate", () => {
  it("is 0 for a perfect hypothesis", () => {
    const ref: LabeledTurn[] = [
      { startMs: 0, endMs: 1000, speakerId: "A" },
      { startMs: 1000, endMs: 2000, speakerId: "B" },
    ];
    const hyp: LabeledTurn[] = [
      { startMs: 0, endMs: 1000, speakerId: "X" },
      { startMs: 1000, endMs: 2000, speakerId: "Y" },
    ];
    expect(diarizationErrorRate(ref, hyp).der).toBeCloseTo(0);
  });

  it("is 1 when the hypothesis misses all speech", () => {
    const ref: LabeledTurn[] = [{ startMs: 0, endMs: 1000, speakerId: "A" }];
    const r = diarizationErrorRate(ref, []);
    expect(r.der).toBeCloseTo(1);
    expect(r.missedMs).toBe(1000);
  });

  it("scores speaker confusion in the component masses", () => {
    const ref: LabeledTurn[] = [
      { startMs: 0, endMs: 1000, speakerId: "A" },
      { startMs: 1000, endMs: 2000, speakerId: "B" },
    ];
    // One hyp speaker bleeds 200ms into B's region.
    const hyp: LabeledTurn[] = [
      { startMs: 0, endMs: 1200, speakerId: "X" },
      { startMs: 1200, endMs: 2000, speakerId: "Y" },
    ];
    const r = diarizationErrorRate(ref, hyp);
    expect(r.confusionMs).toBe(200);
    expect(r.der).toBeCloseTo(0.1);
  });
});

describe("jaccardErrorRate", () => {
  it("is 0 for a perfect hypothesis", () => {
    const ref: LabeledTurn[] = [{ startMs: 0, endMs: 1000, speakerId: "A" }];
    const hyp: LabeledTurn[] = [{ startMs: 0, endMs: 1000, speakerId: "X" }];
    expect(jaccardErrorRate(ref, hyp)).toBeCloseTo(0);
  });
});

describe("speakerCountAccuracy", () => {
  it("reports ref/hyp counts and signed error", () => {
    const ref: LabeledTurn[] = [
      { startMs: 0, endMs: 1, speakerId: "A" },
      { startMs: 1, endMs: 2, speakerId: "B" },
    ];
    const hyp: LabeledTurn[] = [{ startMs: 0, endMs: 2, speakerId: "X" }];
    expect(speakerCountAccuracy(ref, hyp)).toEqual({ refSpeakers: 2, hypSpeakers: 1, error: -1 });
  });
});

describe("splitMergeRates", () => {
  it("detects a false split (one ref speaker → two hyp speakers)", () => {
    const ref: LabeledTurn[] = [{ startMs: 0, endMs: 2000, speakerId: "A" }];
    const hyp: LabeledTurn[] = [
      { startMs: 0, endMs: 1000, speakerId: "X" },
      { startMs: 1000, endMs: 2000, speakerId: "Y" },
    ];
    expect(splitMergeRates(ref, hyp).falseSplit).toBe(1);
  });

  it("detects a false merge (two ref speakers → one hyp speaker)", () => {
    const ref: LabeledTurn[] = [
      { startMs: 0, endMs: 1000, speakerId: "A" },
      { startMs: 1000, endMs: 2000, speakerId: "B" },
    ];
    const hyp: LabeledTurn[] = [{ startMs: 0, endMs: 2000, speakerId: "X" }];
    expect(splitMergeRates(ref, hyp).falseMerge).toBe(1);
  });
});

describe("unknownRate", () => {
  it("is the fraction of unattributed hypothesis speech", () => {
    const hyp: LabeledTurn[] = [
      { startMs: 0, endMs: 1000, speakerId: "X" },
      { startMs: 1000, endMs: 2000, speakerId: "" }, // unknown
    ];
    expect(unknownRate(hyp)).toBeCloseTo(0.5);
  });
});

describe("RTTM round-trip", () => {
  it("parses and re-serializes labeled turns", () => {
    const rttm =
      "SPEAKER meeting 1 0.000 1.500 <NA> <NA> spk_1 <NA> <NA>\n" +
      "SPEAKER meeting 1 1.500 2.000 <NA> <NA> spk_2 <NA> <NA>";
    const turns = parseRttm(rttm);
    expect(turns).toEqual([
      { startMs: 0, endMs: 1500, speakerId: "spk_1" },
      { startMs: 1500, endMs: 3500, speakerId: "spk_2" },
    ]);
    expect(parseRttm(toRttm(turns))).toEqual(turns);
  });

  it("ignores non-SPEAKER lines", () => {
    expect(parseRttm("# comment\nSPKR bad line\n")).toEqual([]);
  });
});
