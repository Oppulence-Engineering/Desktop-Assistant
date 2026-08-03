# `vendor/audiocap` — local dual-track meeting capture (macOS)

`oppulence-audiocap` records a meeting the way a local-first app should: your
microphone and everything the Mac plays, as **two separate tracks**, straight to disk,
with nothing leaving the machine.

Electron cannot do this. Chromium's `getDisplayMedia({audio:"loopback"})` gives at
best one mixed stream, is gated behind an experimental feature flag on macOS 15+, and
runs in the renderer — so the recording dies with the window and no audio is ever
persisted. Core Audio process taps are only reachable from native code, hence a
sidecar. It is spawned and supervised by the main process the same way `whisper-cli`
is (`vendor/whisper`), and it is deliberately dumb: capture and write files. Session
naming, the transcription queue, notes, and retention all live in
`packages/core/src/meetings`.

## Why two tracks

Mic-versus-system is free two-party attribution — `me` and `them` with no
speaker-identification model — and speech models transcribe clean single-source audio
better than a mix. It also means someone talking over the other party is preserved on
both tracks, instead of one being gated out of the transcript to stop echo.

## Layout

```
vendor/audiocap/
  build.sh                  # SwiftPM release build for one arch + toolchain preflight
  Sources/audiocap/
    main.swift              # CLI, signal + stdin handling, version constant
    Session.swift           # both tracks + meta.json + level timer
    MicRecorder.swift       # AVAudioEngine, optional echo cancellation
    SystemAudioRecorder.swift  # Core Audio process tap
    TrackWriter.swift       # convert → 16 kHz mono WAV, crash-safe append
    ParakeetEngine.swift    # Core ML transcription + model download
    Codec.swift             # AAC compress/decode for retained audio
    Doctor.swift            # permission/device preflight
    Protocol.swift          # NDJSON event writer
    Info.plist              # embedded via -sectcreate for TCC attribution
  Tests/audiocapTests/      # token→word→segment logic (needs Xcode; runs in CI)
  <platform>-<arch>/        # built binary (git-ignored; CI artifact)
    oppulence-audiocap
```

`<platform>-<arch>/` and `out/` are **git-ignored** — binaries are CI artifacts, not
source. At dev time they are usually absent, and the app falls back to renderer
capture. To run locally, build one (below) or point `ROWBOAT_AUDIOCAP_BIN` at it.

## On SwiftPM

The capture half needs only system frameworks. The transcription half depends on
[FluidAudio](https://github.com/FluidInference/FluidAudio) — the Core ML port of
Parakeet — so the package has a manifest and a `Package.resolved`.

This started as a bare `swiftc` build precisely to avoid that coupling: SwiftPM's
manifest compiler is tightly bound to the toolchain version and fails outright on a
damaged Command Line Tools install. Adding a real dependency changed the trade, and
`build.sh` now preflights the toolchain instead of avoiding it.

## Building

```bash
./build.sh                       # host arch
./build.sh x86_64                # cross-build for Intel
mkdir -p darwin-arm64 && cp out/oppulence-audiocap darwin-arm64/

# then run the app against it
ROWBOAT_AUDIOCAP_BIN="$PWD/darwin-arm64/oppulence-audiocap" npm run dev
```

`build.sh` preflights the toolchain, because both known failure modes produce errors
that name the SDK and read like code problems:

- **Two module maps defining `SwiftBridging`** — a stale `module.modulemap` beside the
  current `bridging.modulemap`. Apple renamed the file; older Command Line Tools
  installs leave the original behind, and every Objective-C module import then fails.
- **A compiler and SDK from different Swift releases** — the SDK's prebuilt
  `.swiftinterface` modules are stamped with the `swiftlang` build that produced them
  and the compiler refuses a mismatch, so nothing importing Foundation compiles.

Both mean the Command Line Tools tree is a mix of versions. Reinstalling is the
reliable fix:

```sh
sudo rm -rf /Library/Developer/CommandLineTools
xcode-select --install
```

## Output

One directory per session, named by the host:

| File         | Contents                                                           |
| ------------ | ------------------------------------------------------------------ |
| `mic.wav`    | your side — 16 kHz mono 16-bit PCM                                 |
| `system.wav` | everything the Mac played: the other side of the call, same format |
| `meta.json`  | timings, per-track start offsets, peak level, warnings             |

**16 kHz mono** because that is what both transcription engines consume, and nothing
else in the repo can decode audio. A higher-fidelity archive would buy nothing for
re-transcription — every ASR model here resamples to 16 kHz regardless.

Retained recordings are compressed to `.m4a` after transcription (`compress`), which is
~7.7× smaller — 15 MB per hour per track instead of 115 — and costs **0.76 % WER** on
the round-trip, measured. `decode` turns them back into exactly what capture produced,
so re-transcription works on a compressed session.

**Crash safety:** the WAV header is written up front with zero sizes and patched on
clean stop, and samples are appended raw. Kill the process at any point and every
sample it wrote is still on disk; only the two size fields are stale, and
`recoverWavHeader` in `packages/core/src/meetings` rebuilds them from the file length.
That is the same "a crash mid-meeting loses nothing" property quill gets from CAF,
without an AAC decode step later.

## Protocol

NDJSON on **stdout** (nothing else ever goes there — logs go to stderr):

| Event           | Payload                                                             |
| --------------- | ------------------------------------------------------------------- |
| `started`       | `tracks[]` that actually opened, `warnings[]`                       |
| `level`         | `peaks: {mic, system}` — 0…1, every 200 ms                          |
| `warning`       | `code`, `message` — session continues, degraded                     |
| `error`         | `code`, `message` — fatal; whatever is on disk is still salvageable |
| `stopped`       | `metaPath`, `durationSeconds` — files are finalized                 |
| `modelProgress` | `fraction`, `phase` — transcription-model download                  |

Commands on **stdin**: `stop`. `SIGTERM`/`SIGINT` do the same, and stdin EOF (the
host died) also stops cleanly rather than leaking a recorder. `level` doubles as proof
of life: a track reporting `0` for a whole meeting recorded digital silence, which the
host can surface while there is still time to fix it.

## Transcription

`transcribe` runs Parakeet TDT 0.6B on the Neural Engine and prints timed segments as
JSON. Measured on an M-series machine: **0.52 s fixed cost per invocation, then ~70×
realtime** — about 54 s for an hour-long track, against roughly 3.3 minutes for
whisper.cpp `base.en`. v3 is multilingual (28 European languages) and the default; v2 is
English-only.

Models are ~600 MB and download once into FluidAudio's cache. `models` reports whether
they are present, `models --ensure` fetches them with progress — worth running before a
meeting rather than discovering it during one. The host keeps whisper as the default and
falls back to it whenever the models are absent, so choosing "fast" can never mean
"no transcript".

## Gotchas

- **The system tap is global.** Notification sounds, music, everything the Mac plays
  lands in `system.wav`. Surface that in the UI; there is no per-process picker.
- **Echo cancellation is off by default** (`--voice-processing` to enable). On
  headphones there is no echo to cancel and raw capture is better. On speakers,
  enable it or the meeting audio is transcribed twice — once as them, once as you.
- **`VoiceProcessingIO` is a duplex unit, not an input effect.** Enabling it and then
  accepting `inputNode.outputFormat(forBus:)` as the client format yields buffers of
  digital zeros on multichannel routes: a file with a correct duration and no signal.
  `MicRecorder` completes the graph explicitly and still checks the first second for
  signal, restarting raw if it is flat. When testing a mic change, assert **level**,
  not duration.
- **Permissions:** microphone, plus Screen & System Audio Recording for the tap.
  `doctor` reports the microphone directly. System-audio state cannot be read without
  requesting it, so that check only runs with `--probe-system-audio` — creating the
  throwaway tap can fire the one-time prompt, which should follow a user action.
- **Parakeet's sub-word tokens mark words with a leading space**, not the SentencePiece
  U+2581 marker. Handling only the marker collapses a whole meeting into one "word" —
  which still yields a readable transcript, just with every timestamp wrong, so it
  destroys the interleaving of the two tracks without looking broken. Covered by tests.
- **`ASRResult.duration` is 0 on the file path**, so the no-timings fallback measures
  the file itself instead.
