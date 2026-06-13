import { performance } from "node:perf_hooks";
import type { WhisperAccel, WhisperDiagnosticResult } from "@x/shared/dist/transcription.js";
import { codeOf } from "./errors.js";

export interface DiagnosticTranscript {
  text: string;
  rtf: number;
  durationMs?: number;
  engineLog?: string;
}

export interface DiagnosticInput {
  pcm16: Int16Array;
  sampleRate: 16000;
  model: string;
  accel: WhisperAccel;
  expectedText?: string;
  retainDiagnostics?: boolean;
  transcribe: () => Promise<DiagnosticTranscript>;
}

export async function runWhisperDiagnostic(
  input: DiagnosticInput,
): Promise<WhisperDiagnosticResult> {
  const sampleSeconds = input.pcm16.length / input.sampleRate;
  const startedAt = performance.now();

  try {
    const result = await input.transcribe();
    const durationMs = result.durationMs ?? performance.now() - startedAt;
    return {
      success: true,
      provider: "whisper-local",
      model: input.model,
      accel: input.accel,
      sampleSeconds,
      durationMs,
      rtf: result.rtf,
      text: result.text,
      ...(input.retainDiagnostics === false ? {} : { engineLog: result.engineLog }),
    };
  } catch (err) {
    return {
      success: false,
      provider: "whisper-local",
      model: input.model,
      accel: input.accel,
      sampleSeconds,
      durationMs: performance.now() - startedAt,
      code: codeOf(err),
    };
  }
}
