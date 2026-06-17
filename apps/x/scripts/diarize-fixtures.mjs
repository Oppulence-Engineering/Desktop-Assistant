#!/usr/bin/env node
/**
 * Offline diarization fixture runner (RFC 017 §"Fixture runner").
 *
 *   node scripts/diarize-fixtures.mjs diarize \
 *     --input fixtures/meeting_two_speakers.wav \
 *     --rttm  fixtures/meeting_two_speakers.rttm \
 *     [--transcript fixtures/meeting_two_speakers.json] \
 *     [--model speaker-embedding-v1] [--category two_speakers] [--out report.json]
 *
 * Runs the diarizer over a fixture WAV with the deterministic energy-profile
 * embedder + offline VAD (no whisper binary / native model needed) and prints a
 * JSON report (DER/JER, speaker-count, split/merge, unknown rate, confusion
 * matrix, timing, memory) suitable for CI gating. Requires a prior build:
 *   npm run deps  (shared → core → preload)
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

const dist = "../packages/core/dist/voice/diarization/index.js";
const { decodeWav, runDiarizerOverPcm, buildFixtureReport, parseRttm } = await import(
  new URL(dist, import.meta.url)
);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) args[a.slice(2)] = argv[++i];
  }
  return args;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== "diarize") {
    console.error(
      "usage: diarize-fixtures.mjs diarize --input <wav> --rttm <rttm> [--transcript <json>] [--out <json>]",
    );
    process.exit(2);
  }
  const args = parseArgs(rest);
  if (!args.input || !args.rttm) {
    console.error("error: --input and --rttm are required");
    process.exit(2);
  }

  const wavBytes = await readFile(args.input);
  const { pcm, sampleRate, channels } = decodeWav(wavBytes);
  // Diarize the first channel (offline VAD is mono); stereo fixtures are mixed.
  const mono = channels > 1 ? deinterleaveFirst(pcm, channels) : pcm;
  const audioDurationMs = (mono.length / sampleRate) * 1000;

  const { turns, elapsedMs } = await runDiarizerOverPcm(mono, sampleRate, {
    fixtureMode: true,
    ...(args.model ? { model: args.model } : {}),
  });

  const reference = parseRttm(await readFile(args.rttm, "utf8"));
  const report = buildFixtureReport({
    dataset: { name: basename(args.input), category: args.category, durationMs: audioDurationMs },
    reference,
    hypothesisTurns: turns,
    elapsedMs,
    audioDurationMs,
    peakRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
  });

  const json = JSON.stringify(report, null, 2);
  if (args.out) await writeFile(args.out, json);
  console.log(json);
  // Exit non-zero on egregious failure so CI can gate (threshold is advisory in v1).
  process.exit(report.der.der > 0.9 ? 1 : 0);
}

function deinterleaveFirst(interleaved, channels) {
  const n = Math.floor(interleaved.length / channels);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = interleaved[i * channels];
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
