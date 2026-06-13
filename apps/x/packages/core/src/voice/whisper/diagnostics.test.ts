import { describe, expect, it, vi } from "vitest";
import { runWhisperDiagnostic } from "./diagnostics.js";

describe("runWhisperDiagnostic", () => {
  it("returns latency, model, accel, text, and engine log", async () => {
    const result = await runWhisperDiagnostic({
      pcm16: new Int16Array(16000),
      sampleRate: 16000,
      model: "base.en-q5_1",
      accel: "coreml",
      expectedText: "quick brown fox",
      transcribe: vi.fn().mockResolvedValue({
        text: "quick brown fox",
        rtf: 2.3,
        durationMs: 900,
        engineLog: "Core ML model loaded",
      }),
    });

    expect(result).toMatchObject({
      success: true,
      provider: "whisper-local",
      model: "base.en-q5_1",
      accel: "coreml",
      text: "quick brown fox",
      rtf: 2.3,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.engineLog).toContain("Core ML model loaded");
  });

  it("redacts engine log when diagnostics retention is disabled", async () => {
    const result = await runWhisperDiagnostic({
      pcm16: new Int16Array(16000),
      sampleRate: 16000,
      model: "base.en-q5_1",
      accel: "metal",
      retainDiagnostics: false,
      transcribe: vi.fn().mockResolvedValue({
        text: "hello",
        rtf: 1.1,
        durationMs: 1200,
        engineLog: "sensitive path /Users/example/audio.wav",
      }),
    });

    expect(result.success).toBe(true);
    expect(result.engineLog).toBeUndefined();
  });
});
