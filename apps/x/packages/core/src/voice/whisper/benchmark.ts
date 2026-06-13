import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { WhisperAccel, WhisperBenchmarkProfile } from "@x/shared/dist/transcription.js";

export interface AutoModelInput {
  accel: WhisperAccel;
  memoryGb: number;
  profiles: Array<Pick<WhisperBenchmarkProfile, "model" | "rtf">>;
}

export const MODEL_RANK = ["tiny.en-q5_1", "base.en-q5_1", "small.en-q5_1", "medium.en-q5_0"];
export const BENCHMARK_SAMPLE_RATE = 16000;

export interface BenchmarkAudio {
  pcm16: Int16Array;
  sampleRate: typeof BENCHMARK_SAMPLE_RATE;
}

const MIN_RTF_BY_ACCEL: Record<WhisperAccel, number> = {
  coreml: 2.5,
  metal: 2,
  cuda: 2,
  vulkan: 1.8,
  cpu: 1.2,
};

function memoryAllows(model: string, memoryGb: number): boolean {
  if (model.startsWith("medium")) return memoryGb >= 16;
  if (model.startsWith("small")) return memoryGb >= 8;
  return memoryGb >= 0;
}

export function chooseAutoModel(input: AutoModelInput): string {
  const minRtf = MIN_RTF_BY_ACCEL[input.accel];
  const measured = new Map<string, number>();
  for (const profile of input.profiles) {
    if (!Number.isFinite(profile.rtf)) continue;
    measured.set(profile.model, Math.max(profile.rtf, measured.get(profile.model) ?? 0));
  }

  let selected = "base.en-q5_1";
  for (const model of MODEL_RANK) {
    const rtf = measured.get(model);
    if (rtf == null || rtf < minRtf || !memoryAllows(model, input.memoryGb)) continue;
    selected = model;
  }
  return selected;
}

function fixtureCandidates(): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.join(moduleDir, "__fixtures__", "asr", "quick-brown-fox.wav"),
    path.join(
      moduleDir,
      "..",
      "..",
      "..",
      "src",
      "voice",
      "whisper",
      "__fixtures__",
      "asr",
      "quick-brown-fox.wav",
    ),
  ];
}

function parseMono16kPcmWav(raw: Buffer): Int16Array {
  if (
    raw.length < 44 ||
    raw.toString("ascii", 0, 4) !== "RIFF" ||
    raw.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("benchmark fixture is not a RIFF/WAVE file");
  }

  let fmt: {
    audioFormat: number;
    channels: number;
    sampleRate: number;
    bitsPerSample: number;
  } | null = null;
  let data: Buffer | null = null;
  let offset = 12;
  while (offset + 8 <= raw.length) {
    const id = raw.toString("ascii", offset, offset + 4);
    const size = raw.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > raw.length) throw new Error("benchmark fixture has a truncated WAV chunk");

    if (id === "fmt ") {
      fmt = {
        audioFormat: raw.readUInt16LE(start),
        channels: raw.readUInt16LE(start + 2),
        sampleRate: raw.readUInt32LE(start + 4),
        bitsPerSample: raw.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      data = raw.subarray(start, end);
    }

    offset = end + (size % 2);
  }

  if (
    !fmt ||
    fmt.audioFormat !== 1 ||
    fmt.channels !== 1 ||
    fmt.sampleRate !== BENCHMARK_SAMPLE_RATE ||
    fmt.bitsPerSample !== 16 ||
    !data ||
    data.length < 2
  ) {
    throw new Error("benchmark fixture must be 16 kHz mono PCM16 WAV");
  }

  const samples = new Int16Array(Math.floor(data.length / 2));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = data.readInt16LE(i * 2);
  }
  return samples;
}

function fitToSeconds(pcm: Int16Array, seconds: number): Int16Array {
  const targetFrames = Math.max(1, Math.round(seconds * BENCHMARK_SAMPLE_RATE));
  if (pcm.length === targetFrames) return pcm;
  const out = new Int16Array(targetFrames);
  for (let offset = 0; offset < targetFrames; offset += pcm.length) {
    out.set(pcm.subarray(0, Math.min(pcm.length, targetFrames - offset)), offset);
  }
  return out;
}

function makeBenchmarkFallbackSignal(seconds: number): Int16Array {
  const frames = Math.max(1, Math.round(seconds * BENCHMARK_SAMPLE_RATE));
  const pcm = new Int16Array(frames);
  let noise = 0x12345678;
  for (let i = 0; i < frames; i++) {
    noise = (1664525 * noise + 1013904223) >>> 0;
    const t = i / BENCHMARK_SAMPLE_RATE;
    const syllable = Math.sin(2 * Math.PI * 4.5 * t) > -0.45 ? 1 : 0.15;
    const glottal = Math.sin(2 * Math.PI * 125 * t);
    const formants =
      Math.sin(2 * Math.PI * 650 * t) * 0.35 + Math.sin(2 * Math.PI * 1450 * t) * 0.18;
    const breath = ((noise / 0xffffffff) * 2 - 1) * 0.04;
    pcm[i] = Math.round((glottal * 0.22 + formants * 0.2 + breath) * syllable * 32767);
  }
  return pcm;
}

export async function loadBenchmarkAudio(seconds: number): Promise<BenchmarkAudio> {
  for (const candidate of fixtureCandidates()) {
    try {
      const pcm16 = parseMono16kPcmWav(await fs.readFile(candidate));
      return { pcm16: fitToSeconds(pcm16, seconds), sampleRate: BENCHMARK_SAMPLE_RATE };
    } catch {
      // Try the next location; packaged builds may not include source fixtures.
    }
  }
  return { pcm16: makeBenchmarkFallbackSignal(seconds), sampleRate: BENCHMARK_SAMPLE_RATE };
}
