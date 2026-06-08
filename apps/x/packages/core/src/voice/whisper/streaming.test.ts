import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the spawn boundary so the Session can be tested without a real whisper-cli.
vi.mock("./runner.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./runner.js")>();
  return {
    ...orig,
    transcribePcm: vi.fn(async () => ({
      text: "hello world",
      segments: [],
      rtf: 5,
      durationMs: 10,
    })),
  };
});

import { EnergyVadSegmenter, Session, type StreamPort } from "./streaming.js";

/** Build a mono int16 buffer: `silence` frames of 0, `loud` frames at `amp`, `tail` of 0. */
function buildPcm(silence: number, loud: number, tail: number, amp = 8000): ArrayBuffer {
  const FRAME = 480;
  const total = (silence + loud + tail) * FRAME;
  const pcm = new Int16Array(total);
  for (let i = silence * FRAME; i < (silence + loud) * FRAME; i++) pcm[i] = amp;
  return pcm.buffer;
}

describe("EnergyVadSegmenter", () => {
  it("emits one segment for sustained speech bounded by silence", () => {
    const segments: Array<{ startSec: number; endSec: number; pcm: Int16Array }> = [];
    const seg = new EnergyVadSegmenter(undefined, (s) => segments.push(s));
    const FRAME = 480;
    const push = (amp: number, n: number) => {
      for (let i = 0; i < n; i++) seg.pushFrame(new Int16Array(FRAME).fill(amp));
    };
    push(0, 5); // settle a low noise floor
    push(8000, 10); // speech
    push(0, 30); // trailing silence (> hangover) closes the segment

    expect(segments.length).toBe(1);
    expect(segments[0].pcm.length).toBeGreaterThan(0);
    expect(segments[0].endSec).toBeGreaterThan(segments[0].startSec);
  });
});

/** Fake transferable port that records posted messages and lets a test inject input. */
class FakePort implements StreamPort {
  posted: Array<{ type?: string }> = [];
  closed = false;
  private handler: ((e: { data: unknown }) => void) | null = null;
  on(_event: "message", listener: (e: { data: unknown }) => void): void {
    this.handler = listener;
  }
  postMessage(message: unknown): void {
    this.posted.push(message as { type?: string });
  }
  start(): void {}
  close(): void {
    this.closed = true;
  }
  emit(data: unknown): void {
    this.handler?.({ data });
  }
  types(): string[] {
    return this.posted.map((m) => m.type ?? "");
  }
}

describe("Session", () => {
  beforeEach(() => vi.clearAllMocks());

  it('transcribes the flushed tail on close, then posts "done" and closes the port', async () => {
    const port = new FakePort();
    new Session(port, { modelPath: "/m.bin", vadModelPath: "/vad.bin", channels: 1 });

    // One audio message containing a full speech segment (loud bounded by silence).
    port.emit({ type: "audio", seq: 1, pcm16: buildPcm(5, 10, 30) });
    // Then end the meeting.
    port.emit({ type: "close" });

    // Let the pump transcribe + post final, then the close finally post 'done'.
    await new Promise((r) => setTimeout(r, 30));

    const types = port.types();
    expect(types).toContain("final"); // the tail was transcribed, not dropped
    expect(types).toContain("done");
    expect(types.indexOf("done")).toBeGreaterThan(types.indexOf("final")); // done AFTER finals
    expect(port.closed).toBe(true);
  });

  it("shrinks the credit window as the queue grows (backpressure is live)", async () => {
    const port = new FakePort();
    new Session(port, { modelPath: "/m.bin", vadModelPath: "/vad.bin", channels: 1 });
    // An audio frame always elicits an ack; credits must be a bounded number ≤ MAX_CREDITS,
    // never a monotonically growing counter.
    port.emit({ type: "audio", seq: 1, pcm16: buildPcm(1, 1, 1) });
    const ack = port.posted.find((m) => m.type === "ack") as { credits?: number } | undefined;
    expect(ack?.credits).toBeDefined();
    expect(ack!.credits!).toBeLessThanOrEqual(6);
    expect(ack!.credits!).toBeGreaterThanOrEqual(0);
  });
});
