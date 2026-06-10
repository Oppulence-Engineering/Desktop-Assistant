# ASR eval corpus (RFC 009 §27, Appendix V)

A small, **license-clear** set of short clips (3–15 s) with reference transcripts,
used by `whisper.eval.test.ts` to gate WER regressions across model/binary bumps.

`manifest.json` is an array of:

```jsonc
{
  "id": "clean-01", // stable id
  "wav": "clean-01.wav", // 16 kHz mono 16-bit WAV, committed alongside
  "ref": "schedule the meeting for tuesday at three", // normalized reference
  "bucket": "clean", // clean | noisy | accented | numbers | multilang
  "lang": "en",
}
```

The harness is **skipped** when the manifest is empty or no `whisper-cli` is
available (`ROWBOAT_WHISPER_BIN` unset), so it never blocks CI before the corpus
lands. To run it locally: add clips + entries here, build a binary
(`vendor/whisper/build.sh`), download the eval model, and:

```bash
ROWBOAT_WHISPER_BIN=/path/to/whisper-cli \
ROWBOAT_WHISPER_EVAL_MODEL=~/.solomon-ai/models/ggml-base.en-q5_1.bin \
  npx vitest run src/voice/whisper/whisper.eval.test.ts
```

Audio is intentionally **not** generated here — commit only clips we have the
rights to redistribute.
