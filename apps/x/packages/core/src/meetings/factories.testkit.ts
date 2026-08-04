import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { MeetingSessionMeta, MeetingTrackMeta } from "@x/shared/dist/meetings.js";
import type { MeetingTranscriber } from "./transcribe.js";

/** Fixtures for the meetings module. Kept out of `*.test.ts` so several suites can
 *  share them, mirroring `mailbox/factories.testkit.ts`. */

export const SAMPLE_RATE = 16000;

/** 16-bit PCM sine at `amplitude` (0…1) — loud enough to clear the silence gate. */
export function tone(seconds: number, amplitude = 0.5, hz = 440): Int16Array {
  const samples = new Int16Array(Math.floor(seconds * SAMPLE_RATE));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * amplitude * 32767);
  }
  return samples;
}

export function silence(seconds: number): Int16Array {
  return new Int16Array(Math.floor(seconds * SAMPLE_RATE));
}

/** Audible but below the silence gate — room tone, not speech. */
export function nearSilence(seconds: number): Int16Array {
  return tone(seconds, 0.002);
}

export interface WriteWavOpts {
  /** Leave the RIFF/data size fields at zero, as a killed writer would. */
  unfinalized?: boolean;
  channels?: number;
  sampleRate?: number;
}

export async function writeWav(
  file: string,
  samples: Int16Array,
  opts: WriteWavOpts = {},
): Promise<void> {
  const channels = opts.channels ?? 1;
  const sampleRate = opts.sampleRate ?? SAMPLE_RATE;
  const dataBytes = samples.length * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(opts.unfinalized ? 0 : 36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(opts.unfinalized ? 0 : dataBytes, 40);

  const body = Buffer.alloc(dataBytes);
  for (let i = 0; i < samples.length; i++) body.writeInt16LE(samples[i], i * 2);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.concat([header, body]));
}

export function trackMeta(over: Partial<MeetingTrackMeta> = {}): MeetingTrackMeta {
  return {
    id: "mic",
    speaker: "me",
    file: "mic.wav",
    offset_ms: 0,
    frames: SAMPLE_RATE,
    duration_ms: 1000,
    peak: 0.5,
    silent: false,
    ...over,
  };
}

export function sessionMeta(over: Partial<MeetingSessionMeta> = {}): MeetingSessionMeta {
  return {
    schema: 1,
    sidecar_version: "0.1.0",
    started: "2026-07-29T10:00:00.000Z",
    ended: "2026-07-29T10:01:00.000Z",
    duration_seconds: 60,
    audio: { sample_rate: SAMPLE_RATE, channels: 1, encoding: "pcm_s16le", container: "wav" },
    tracks: [trackMeta()],
    warnings: [],
    ...over,
  };
}

/**
 * A transcriber that returns one segment per call, so a test can assert exactly how
 * chunk and track offsets were applied. Records every call it received.
 */
export function fakeTranscriber(
  segmentsFor: (call: number, pcm: Int16Array) => { start: number; end: number; text: string }[] = (
    call,
  ) => [{ start: 0, end: 1, text: `chunk ${call}` }],
  /**
   * What the engine reports back about the run. Real engines report the *effective*
   * language, which is not always the requested one — whisper.cpp ignores `--language`
   * on an English-only model and answers `en` regardless.
   */
  report: (
    call: number,
    lang: string | undefined,
  ) => { language?: string; multilingualModel?: boolean } = () => ({}),
): MeetingTranscriber & { calls: { samples: number; lang?: string }[] } {
  const calls: { samples: number; lang?: string }[] = [];
  return {
    calls,
    async transcribe(pcm, opts) {
      calls.push({ samples: pcm.length, lang: opts?.lang });
      return {
        segments: segmentsFor(calls.length - 1, pcm),
        ...report(calls.length - 1, opts?.lang),
      };
    },
  };
}
