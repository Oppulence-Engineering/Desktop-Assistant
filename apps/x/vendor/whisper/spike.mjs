#!/usr/bin/env node
// WP 0.1 spike (RFC 009 §26): transcribe a fixture WAV with the built whisper-cli
// and report real-time factor (RTF) + optional WER. Reuses the production runner
// + WER util from @x/core so the spike exercises the exact code path the app uses.
//
// Usage (run from apps/x after `npm run deps` and building a binary):
//   ROWBOAT_WHISPER_BIN=vendor/whisper/darwin-arm64/whisper-cli \
//     node vendor/whisper/spike.mjs <fixture.wav-or-pcm> <model.bin> ["reference text"]
//
// Pass a 16 kHz mono int16 .pcm (raw) or .wav. RTF > 1 means faster than realtime.
import { readFile } from "node:fs/promises";
import { run } from "@x/core/dist/voice/whisper/runner.js";
import { wer } from "@x/core/dist/voice/whisper/wer.js";
import { configureWhisperBinary } from "@x/core/dist/voice/whisper/bin.js";

async function main() {
  const [input, modelPath, reference] = process.argv.slice(2);
  if (!input || !modelPath) {
    console.error("usage: spike.mjs <fixture.wav> <model.bin> [reference text]");
    process.exit(2);
  }
  if (process.env.ROWBOAT_WHISPER_BIN) configureWhisperBinary(process.env.ROWBOAT_WHISPER_BIN);

  // run() reads a WAV file directly; for a raw .pcm you'd wrap it first. We assume
  // a .wav fixture here (16 kHz mono, 16-bit) so the spike stays a thin harness.
  const buf = await readFile(input);
  // 16-bit mono @ 16 kHz: samples = (bytes - 44 header) / 2; seconds = samples / 16000.
  const audioSeconds = Math.max(0.1, (buf.length - 44) / 2 / 16000);

  const t0 = Date.now();
  const result = await run(input, { modelPath, audioSeconds });
  const wallSeconds = (Date.now() - t0) / 1000;

  console.log(`text:  ${result.text}`);
  console.log(
    `audio: ${audioSeconds.toFixed(2)}s   wall: ${wallSeconds.toFixed(2)}s   RTF: ${result.rtf.toFixed(2)}x`,
  );
  if (reference) {
    console.log(`WER:   ${(wer(reference, result.text) * 100).toFixed(1)}%`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
