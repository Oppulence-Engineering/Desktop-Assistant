import { describe, expect, it, vi } from "vitest";
import { runWhisperDiagnostic } from "./diagnostics.js";

describe("runWhisperDiagnostic", () => {
  it("redacts engine log by default", async () => {
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
    expect(result.engineLog).toBeUndefined();
  });

  it("includes engine log only when diagnostics retention is enabled", async () => {
    const result = await runWhisperDiagnostic({
      pcm16: new Int16Array(16000),
      sampleRate: 16000,
      model: "base.en-q5_1",
      accel: "metal",
      retainDiagnostics: true,
      transcribe: vi.fn().mockResolvedValue({
        text: "hello",
        rtf: 1.1,
        durationMs: 1200,
        engineLog: "sensitive path /Users/example/audio.wav",
      }),
    });

    expect(result.success).toBe(true);
    expect(result.engineLog).toContain("sensitive path");
  });
});
