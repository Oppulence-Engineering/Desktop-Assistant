# `vendor/whisper` — bundled `whisper-cli` binaries (RFC 009)

The desktop ships a per-arch, statically-linked, **signed** `whisper-cli` so local
on-device transcription works offline with no Node-ABI coupling (we spawn the
binary; we do not load a native addon). See
[`apps/rfc/009-local-on-device-transcription.md`](../../../rfc/009-local-on-device-transcription.md)
§20 + Appendices H/I/W.

## Layout

```
vendor/whisper/
  PIN                       # pinned whisper.cpp tag — the single source of truth
  build.sh                  # builds a static whisper-cli from the pinned tag (per arch)
  spike.mjs                 # WP 0.1 spike: transcribe a fixture WAV, measure RTF
  <platform>-<arch>/        # built binary (git-ignored; produced by CI, staged at package time)
    whisper-cli[.exe]
```

The `<platform>-<arch>/` directories are **git-ignored** — binaries are CI
artifacts, not source. At dev time they are usually absent, so the app falls
back to cloud transcription (the capability gate sees no binary). To run locally,
build one (below) or point `ROWBOAT_WHISPER_BIN` at a `whisper-cli`.

## Building

```bash
# macOS arm64 (Metal + Core ML, with fallback when a sidecar is absent)
./build.sh "-DCMAKE_OSX_ARCHITECTURES=arm64 -DGGML_METAL=ON -DWHISPER_COREML=ON -DWHISPER_COREML_ALLOW_FALLBACK=ON"
mkdir -p darwin-arm64 && cp out/whisper-cli darwin-arm64/

# then either:
ROWBOAT_WHISPER_BIN="$PWD/darwin-arm64/whisper-cli" node spike.mjs path/to/fixture.wav ~/.solomon-ai/models/ggml-base.en-q5_1.bin
```

CI (`.github/workflows/whisper-build.yml`) builds the full matrix, signs the
macOS binary under the app's hardened runtime, and uploads per-arch artifacts the
release pipeline stages into these directories before `electron-forge make`.
The model manager downloads the matching `*-encoder.mlmodelc.zip` Core ML
sidecar next to each macOS model from the pinned catalog metadata; quantized
models share the upstream unquantized sidecar name, e.g.
`ggml-base.en-q5_1.bin` uses `ggml-base.en-encoder.mlmodelc`.

## Upgrading whisper.cpp

Bump the one line in `PIN` (e.g. `v1.7.6` → `v1.8.0`). That re-triggers the build
workflow and is the only place the version is declared. After a bump, re-run the
checksum fetcher so the model catalog stays consistent:

```bash
node ../../scripts/whisper-fetch-checksums.mjs
```
