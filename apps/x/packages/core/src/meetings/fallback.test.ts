import { describe, expect, it } from "vitest";
import { withTranscriberFallback } from "./fallback.js";
import type { MeetingTranscriber } from "./transcribe.js";
import { silence, tone } from "./factories.testkit.js";

/**
 * Guards a real failure seen on a real recording: Parakeet returned zero tokens for a
 * clearly audible system track that whisper transcribed correctly. For a meeting that
 * means losing one side of the conversation with nothing to notice.
 */

function fixed(
  segments: { start: number; end: number; text: string }[],
  onCall?: () => void,
): MeetingTranscriber {
  return {
    async transcribe() {
      onCall?.();
      return { segments };
    },
  };
}

const SPEECH = [{ start: 0, end: 1, text: "we agreed on Friday" }];

describe("withTranscriberFallback", () => {
  it("uses the fast engine when it produces anything", async () => {
    let slowCalls = 0;
    const t = withTranscriberFallback(
      fixed(SPEECH),
      fixed([{ start: 0, end: 1, text: "slow" }], () => slowCalls++),
    );

    const result = await t.transcribe(tone(1), { channels: 1 });
    expect(result.segments).toEqual(SPEECH);
    expect(slowCalls).toBe(0);
  });

  it("falls back when the fast engine returns nothing for audible audio", async () => {
    const reasons: string[] = [];
    const t = withTranscriberFallback(fixed([]), fixed(SPEECH), {
      onFallback: (r) => reasons.push(r),
    });

    const result = await t.transcribe(tone(1), { channels: 1 });
    expect(result.segments).toEqual(SPEECH);
    expect(reasons[0]).toContain("returned nothing");
  });

  it("does not fall back on silence, where empty is the right answer", async () => {
    let slowCalls = 0;
    const reasons: string[] = [];
    const t = withTranscriberFallback(
      fixed([]),
      fixed(SPEECH, () => slowCalls++),
      { onFallback: (r) => reasons.push(r) },
    );

    const result = await t.transcribe(silence(1), { channels: 1 });
    expect(result.segments).toEqual([]);
    expect(slowCalls).toBe(0);
    expect(reasons).toEqual([]);
  });

  it("falls back when the fast engine throws", async () => {
    const reasons: string[] = [];
    const throwing: MeetingTranscriber = {
      async transcribe() {
        throw new Error("models missing");
      },
    };
    const t = withTranscriberFallback(throwing, fixed(SPEECH), {
      onFallback: (r) => reasons.push(r),
    });

    const result = await t.transcribe(tone(1), { channels: 1 });
    expect(result.segments).toEqual(SPEECH);
    expect(reasons[0]).toContain("models missing");
  });
});
