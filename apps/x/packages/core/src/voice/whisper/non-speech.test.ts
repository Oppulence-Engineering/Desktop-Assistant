import { describe, expect, it } from "vitest";
import { isNonSpeech } from "./non-speech.js";

/**
 * Guards a real regression: a dual-track recording where the microphone held only
 * speaker bleed produced `[Music]`, which would have appeared in the meeting note as
 * a participant saying it.
 */

describe("isNonSpeech", () => {
  it("catches the annotations whisper actually emits for near-silence", () => {
    for (const text of [
      "[Music]",
      "[MUSIC]",
      "[BLANK_AUDIO]",
      "[Applause]",
      "[LAUGHTER]",
      "[ Silence ]",
      "(music)",
      "*coughs*",
      "♪",
      "♪♪♪",
      "[Music] [Applause]",
    ]) {
      expect(isNonSpeech(text), text).toBe(true);
    }
  });

  it("treats empty and punctuation-only output as non-speech", () => {
    for (const text of ["", "   ", ".", "...", " — ", "?!"]) {
      expect(isNonSpeech(text), JSON.stringify(text)).toBe(true);
    }
  });

  it("keeps real speech, including speech that contains an annotation", () => {
    for (const text of [
      "The quick brown fox jumps over the lazy dog.",
      "so [inaudible] by Friday",
      "[Music] and then we agreed on the price",
      "Music is the topic today",
      "No.",
      "♪ we will send it Friday",
    ]) {
      expect(isNonSpeech(text), text).toBe(false);
    }
  });

  it("does not treat an unclosed bracket as an annotation", () => {
    // Better to keep an oddly punctuated real utterance than to drop speech.
    expect(isNonSpeech("[ we agreed")).toBe(false);
  });
});
