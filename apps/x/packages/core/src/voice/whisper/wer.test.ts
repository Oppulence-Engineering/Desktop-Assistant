import { describe, it, expect } from "vitest";
import { wer, normalize } from "./wer.js";

describe("normalize", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalize("  Hello,   THERE!  ")).toEqual(["hello", "there"]);
    expect(normalize("it's four-twenty")).toEqual(["it's", "four", "twenty"]);
  });
});

describe("wer", () => {
  it("is 0 for an exact match (modulo normalization)", () => {
    expect(wer("schedule the meeting", "Schedule the meeting.")).toBe(0);
  });

  it("counts a single substitution", () => {
    // 3 reference words, one wrong → 1/3
    expect(wer("the quick fox", "the slow fox")).toBeCloseTo(1 / 3, 5);
  });

  it("counts deletions and insertions", () => {
    expect(wer("a b c d", "a c d")).toBeCloseTo(1 / 4, 5); // one deletion
    expect(wer("a b c", "a b c d")).toBeCloseTo(1 / 3, 5); // one insertion
  });

  it("handles empty reference", () => {
    expect(wer("", "")).toBe(0);
    expect(wer("", "extra words")).toBe(1);
  });
});
