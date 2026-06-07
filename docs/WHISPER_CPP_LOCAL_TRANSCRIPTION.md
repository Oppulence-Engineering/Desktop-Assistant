# Local Transcription with whisper.cpp — Research & Integration Plan

> Status: **Draft for review.** Goal: support **on-device speech-to-text** in the desktop app
> (`apps/x`) via [whisper.cpp](https://github.com/ggml-org/whisper.cpp), as a cheaper (and more
> private) alternative to the current cloud transcription API. Grounded in the app's real STT code
> and current (June 2026) whisper.cpp sources.

---

## 1. TL;DR / Recommendation

- **Today, every spoken word is billed.** All STT goes to **Deepgram** (`nova-3`) over a real-time
  WebSocket — either with the user's own Deepgram key or, when signed in, through the **Solomon
  proxy** (which fronts Deepgram and bills us). There is **no local option**.
- **whisper.cpp is a strong fit** for the highest-volume, simplest case — **push-to-talk voice
  input** — where we record an utterance and transcribe it in one batch when the user stops.
  MIT-licensed, runs fully offline, GPU-accelerated (Metal/Core ML on Apple Silicon), and free after
  a one-time model download.
- **Recommended approach:** add a **local "On-device (Whisper)" STT provider** behind the existing
  provider abstraction. Host whisper.cpp in the **main process** (ship the prebuilt `whisper-cli`
  binary per-arch and spawn it as a child process — the most robust packaging path), with a
  **model-manager** that downloads a default model (**`base.en` or `small.en`, q5_1**) to
  `~/.rowboat/models/` on first use. Reuse the renderer's existing 16 kHz mono PCM capture; route it
  to main over IPC instead of to Deepgram.
- **Phase it:** P1 = voice-mode push-to-talk (biggest, simplest win). P2 = meeting transcription
  (workable, but loses Deepgram's live multi-speaker **diarization** — see §8).
- **Tier by feature, not by plan** (see §9): default **voice input → local for everyone** (capable
  devices), **meetings → Deepgram** with a **free monthly cloud quota** that falls back to local. So
  free stays $0-cost + unlimited, paid gets premium cloud, and we keep local as a privacy/offline
  feature for all. Make the default **remote-configurable** and A/B it.
- **Savings:** we use Deepgram nova-3 **streaming ≈ $0.0077/min** (batch is $0.0043; OpenAI Whisper
  API ≈ $0.006/min); local whisper.cpp is **$0/min** after a one-time ~150 MB model download. A user
  doing ~1 hr/day of transcription is **~$95–168/yr** of cloud spend; at 10k active users that's
  **~$1M+/yr** local would eliminate — see §7. Plus it's **private and offline**.

---

## 2. Where we are today (the thing we'd be replacing)

| Aspect            | Detail                                                                                                                                                                                                                                                                             | Source                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Engine**        | Deepgram `nova-3`, real-time streaming over WebSocket                                                                                                                                                                                                                              | `useVoiceMode.ts`, `useMeetingTranscription.ts`     |
| **Audio path**    | Captured in the **renderer** via Web Audio (`AudioContext` @ 16 kHz, `ScriptProcessorNode`), converted float32 → **int16 mono PCM**, streamed as WS binary frames                                                                                                                  | `useVoiceMode.ts:171-194`                           |
| **Two routes**    | (a) **Solomon proxy** `wss://…/deepgram/v1/listen` with a bearer token (signed-in users — billed to us); (b) **direct** `wss://api.deepgram.com/v1/listen` with the user's `deepgram.json` key                                                                                     | `deepgram-listen-url.ts`, `voice.ts:getVoiceConfig` |
| **Voice mode**    | Push-to-talk: stream while held, `submit()` returns the final transcript → composer                                                                                                                                                                                                | `useVoiceMode.ts`                                   |
| **Meeting mode**  | mic (ch0) **+ system audio** via `getDisplayMedia` loopback (ch1) → merged **stereo** PCM → Deepgram with `multichannel` + `diarize` → speaker-labelled note in `knowledge/Meetings/…`. Includes headphone detection, mic-gating when speakers are active, 2-min silence auto-stop | `useMeetingTranscription.ts`                        |
| **TTS (not STT)** | ElevenLabs (`eleven_flash_v2_5`) via proxy or direct key — out of scope here                                                                                                                                                                                                       | `voice.ts:synthesizeSpeech`                         |
| **Config**        | `~/.rowboat/config/deepgram.json`, `elevenlabs.json`; `voice:getConfig` IPC exposes them                                                                                                                                                                                           | `voice.ts`, `apps/main/src/ipc.ts`                  |

**Key takeaways that shape the design:**

1. **The audio we already capture (16 kHz mono int16 PCM) is exactly what whisper.cpp wants** — no
   resampling needed for voice mode. That's a big head start.
2. **STT currently lives in the renderer (browser context).** whisper.cpp is native C++ and must run
   in **main/Node** (or a worker), so the new path is: renderer mic → **IPC** → main (whisper.cpp) →
   transcript back. (The renderer cannot and should not load a native addon.)
3. **Deepgram gives us streaming + diarization for free.** whisper.cpp gives neither out of the box —
   it's batch, and speaker diarization needs an extra pipeline. This is the main feature gap (§8).

---

## 3. whisper.cpp overview (verified, June 2026)

- **What:** a dependency-free C/C++ inference port of OpenAI Whisper on `ggml`/GGUF (ggml-org team).
  Current **v1.8.x** line. **MIT-licensed** (whisper.cpp, ggml, and the Whisper weights) → fully safe
  to bundle/redistribute commercially; just retain the notices.
- **Acceleration:** CPU (AVX2 / NEON / OpenBLAS) plus **Metal + Core ML (ANE, ~3× encoder) on macOS**,
  and **CUDA / Vulkan / OpenVINO / ROCm** elsewhere. Flash attention is on by default since v1.8.0.
- **Built-in VAD (Silero, GGUF) since v1.7.6** (`--vad`): transcribe only speech segments — big
  speedup, cleaner chunk boundaries, and far fewer silence "hallucinations." We should enable it.

**Models** (GGUF, from Hugging Face `ggerganov/whisper.cpp`; `download-ggml-model.sh <name>`):

| Model          | Disk        | Peak RAM | Notes                       |
| -------------- | ----------- | -------- | --------------------------- |
| tiny[.en]      | 75 MiB      | ~273 MB  | fastest, lowest accuracy    |
| **base[.en]**  | **142 MiB** | ~388 MB  | speed/size sweet spot       |
| small[.en]     | 466 MiB     | ~852 MB  | clearly better accuracy     |
| medium[.en]    | 1.5 GiB     | ~2.1 GB  |                             |
| large-v3       | 2.9 GiB     | ~3.9 GB  | best accuracy               |
| large-v3-turbo | 1.5 GiB     | —        | ~large accuracy, ~2× faster |

Quantized variants (`-q5_0`/`-q5_1`/`-q8_0`) cut disk/RAM ~2–3× (`large-v3-turbo-q5_0` ≈ 547 MiB;
`base.en-q5_0` ≈ ~150 MB). For English use q5_0; for multilingual prefer q8_0/f16 to avoid degrading
low-resource languages.

- **Recommended default:** **`base.en` (q5_0, ~150 MB)** — small download, faster-than-realtime
  almost everywhere, decent quality. Offer **`small.en`** (or `large-v3-turbo-q5_0`) as a
  higher-accuracy option; multilingual `base`/`small` only if non-English is needed.

**Performance (rough, hardware-dependent — measure with `whisper-bench`):** On **Apple Silicon
(Metal + Core ML)** tiny/base/small run **~10× realtime** (a 5 s clip in <0.5 s); `large-v3-turbo`
does 60 s of audio in ~2.8 s on an M2 Pro. On **x86 CPU**, `small` ≈ ~6× realtime on a modern desktop
but can drop to **~0.3× (slower than realtime) on weak laptop CPUs** — an iGPU via Vulkan recovers
~3–4×. Resident memory ≈ the "Peak RAM" column while a model is loaded.

---

## 4. Integration options (Node/Electron)

| Option                                                                                 | How                                                                                                   | Pros                                                                                                                                 | Cons                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Spawn prebuilt `whisper-cli` binary** (child process)                             | Ship the per-arch binary in the app; `spawn()` it with a WAV/PCM file or stdin, parse JSON/SRT output | **No native-addon ABI coupling** to Electron's Node; simplest to package and code-sign; crash-isolated; trivial to update the binary | Process-spawn overhead per call (fine for batch); must manage temp audio files / stdin; streaming needs the `stream` example or manual chunking                                                     |
| **B. Native Node addon** (`nodejs-whisper`, `smart-whisper`, whisper.cpp `addon.node`) | `require()` the addon in main; call transcribe in-process                                             | Lower per-call overhead; some support partial streaming                                                                              | **Must be rebuilt against Electron's Node ABI** (`electron-rebuild`/prebuilds) per platform/arch — a real packaging/CI burden; ABI breaks on Electron upgrades; native-module signing complications |

**Recommendation: Option A (spawn the prebuilt `whisper-cli`).** For an Electron app that ships
Electron 39 and upgrades regularly, avoiding native-addon ABI coupling is worth the small spawn
overhead. Batch push-to-talk doesn't need in-process streaming, and a binary is far easier to
**asarUnpack + code-sign/notarize** than a native `.node`. Build the binaries ourselves per-arch in
CI (so we can sign them) rather than relying on upstream releases. Convert mic audio to 16 kHz mono
WAV/PCM first.

**The Node-binding landscape (if we ever want in-process streaming instead of spawning):**

| Library                         | Maintained                   | Install/build                                                     | Prebuilt?                         | GPU                           | Streaming             | Verdict                                                                                        |
| ------------------------------- | ---------------------------- | ----------------------------------------------------------------- | --------------------------------- | ----------------------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| **@kutalia/whisper-node-addon** | ✅ active (v1.1.0, Jul 2025) | `npm i`, **no build**                                             | ✅ prebuilt `.node` mac/win/linux | auto Vulkan/Metal             | ✅ accepts PCM chunks | **best addon option** — "zero-config for Electron"; small project (bus-factor → vendor/pin it) |
| smart-whisper                   | ⚠️ stale (Oct 2024)          | node-gyp                                                          | partial                           | Metal OOB; others BYO-compile | takes raw PCM         | nice API but stale + non-mac GPU pain                                                          |
| nodejs-whisper                  | ~active                      | **compiles whisper.cpp at install, then shells to `whisper-cli`** | ❌                                | CUDA flag                     | ❌                    | **avoid for shipping** (CI/packaging pain; it's just CLI-spawn with an install build)          |
| whisper-node (ariym)            | ❌ abandoned (~3 yr)         | node-gyp                                                          | ❌                                | —                             | ❌                    | no                                                                                             |
| WASM (`bindings/javascript`)    | n/a                          | none                                                              | n/a                               | CPU-only, slow                | —                     | not a desktop default                                                                          |

→ **Ship by spawning our own signed `whisper-cli`.** If low-latency in-process streaming becomes a
hard requirement, adopt **`@kutalia/whisper-node-addon`** (prebuilt, Electron-ready, PCM streaming) —
vendored and pinned.

---

## 5. Recommended architecture (in this codebase)

```
renderer (mic capture, unchanged 16 kHz int16 PCM)
   │  provider === 'whisper-local' ?
   ├─ no  → existing Deepgram WS path (useVoiceMode / useMeetingTranscription)
   └─ yes → accumulate PCM → IPC →  main process
                                      │
                              packages/core/src/voice/whisper.ts  (new)
                                 • WhisperModelManager (download/verify/list models → ~/.rowboat/models)
                                 • transcribe(pcm|wav, { model, lang }) → spawn whisper-cli → text
                                 • (P2) chunker + simple VAD for near-real-time meeting mode
                                      │
                              prebuilt whisper-cli  (asarUnpacked, per-arch)
```

**New pieces:**

1. `packages/core/src/voice/whisper.ts` — model manager + `transcribe()` (spawn `whisper-cli`).
2. **IPC** (`apps/main/src/ipc.ts`, `packages/shared/src/ipc.ts`): `whisper:listModels`,
   `whisper:downloadModel` (with progress events), `whisper:transcribe` (batch), and for P2
   `whisper:startStream`/`pushAudio`/`stopStream`.
3. **Provider abstraction** in `getVoiceConfig`/settings: add `transcription.provider =
'deepgram' | 'solomon' | 'whisper-local'` and a `whisper-local` config (model id).
4. **Renderer**: in `useVoiceMode`/`useMeetingTranscription`, branch on provider — for
   `whisper-local`, send PCM to main instead of opening the Deepgram WS. Voice mode: buffer the
   utterance, transcribe on `submit()`. Meeting mode (P2): chunk + stream to main.
5. **Settings UI** (`settings-dialog.tsx`): a "Transcription" section to pick provider + model, with
   a model-download button + progress + size, mirroring the existing models settings.

**Why this shape:** it slots into the **existing provider pattern** (the app already chooses
between Solomon proxy and direct keys), reuses the **existing mic pipeline**, and keeps native code
in **main** behind IPC. Deepgram stays the default and fallback.

---

## 6. Packaging & distribution

- **Binary, not addon** (per §4): place per-arch `whisper-cli` under e.g.
  `apps/x/apps/main/resources/whisper/<platform>-<arch>/` and mark it **`asarUnpack`** in
  `forge.config.cjs` (binaries can't execute from inside the asar). Resolve the path via
  `process.resourcesPath` in packaged builds.
- **macOS signing/notarization:** the bundled binary must be **signed with the app's Developer ID +
  hardened-runtime** and notarized, or Gatekeeper will block it. Add it to the Forge `osxSign`
  inputs (the app already signs when `APPLE_*` secrets are present). On Apple Silicon, ship the
  **Core ML** encoder model alongside for the speed-up (optional, larger).
- **Models are downloaded, not bundled** (keeps the installer small): fetch on first use from
  Hugging Face to `~/.rowboat/models/`, verify checksum, show progress. Default `base.en` ≈ 140 MB
  (or ~80–90 MB quantized).
- **Size budget:** the perf gate already tracks `packagedAppSizeMb` (900 MB) — the `whisper-cli`
  binaries (a few MB each) fit easily; models stay out of the package.

- **Forge auto-unpack-natives:** Electron Forge's `auto-unpack-natives` plugin unpacks `.node`/native
  files automatically; for the spawned `whisper-cli` (+ any `ggml`/`whisper` dylibs) add an explicit
  `asarUnpack` glob. **Statically link** whisper/ggml into the single `whisper-cli` where possible to
  minimize the number of Mach-O files to sign.
- **Build our own binaries in CI** (per arch: mac arm64/x64, win x64, linux x64/arm64) so every
  Mach-O is signed with our Developer ID + hardened runtime and **notarized** — un-notarized helper
  binaries/dylibs are blocked by Gatekeeper. CUDA builds are much larger; default to CPU/Vulkan on
  Win/Linux and treat GPU as best-effort.

---

## 7. Cost analysis (the "cheaper" argument)

| Provider                | Batch              | Streaming       | ~Per hour         | Notes                                                                               |
| ----------------------- | ------------------ | --------------- | ----------------- | ----------------------------------------------------------------------------------- |
| **Deepgram nova-3**     | $0.0043/min        | **$0.0077/min** | $0.26 / **$0.46** | what we use today (**streaming**), billed via the Solomon proxy for signed-in users |
| **OpenAI Whisper API**  | $0.006/min         | —               | $0.36             | cloud Whisper, batch                                                                |
| **ElevenLabs Scribe**   | ~$0.0037–0.008/min | —               | $0.22–0.48        | (ElevenLabs is our TTS path; STT pricing varies)                                    |
| **whisper.cpp (local)** | **$0**             | **$0**          | **$0**            | free after a one-time model DL; cost = user's CPU/GPU/battery                       |

**Savings:** because we stream, the real comparison is **~$0.0077/min → $0**. A user transcribing
**~1 hr/day** is **~$95–168/yr** of cloud spend (Deepgram streaming ≈ $168, OpenAI batch ≈ $131);
**at 10k active users that's ~$1M+/yr** that local eliminates. Even light use (100 min/user/mo) is
~$0.43–0.77/user/mo (~$4.3–7.7k/mo at 10k users). For us the eliminated cost is the **proxy** spend,
directly improving unit economics — plus **privacy/offline** (audio never leaves the device). The
tradeoff: we spend the **user's** compute/battery and get lower accuracy/diarization than top cloud.

---

## 8. Feature mapping & the diarization gap (important)

| Capability today (Deepgram)                 | whisper.cpp local                                                                                                                 | Verdict                                                                                                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Push-to-talk voice input**                | Batch-transcribe the recorded utterance on stop                                                                                   | ✅ **Excellent fit** — accurate, simple, the biggest cost win                                                                                                                   |
| Real-time interim text while speaking       | Near-real-time via chunking (latency ~1–2 s/chunk)                                                                                | 🟡 Workable, worse UX than Deepgram's instant interim                                                                                                                           |
| Punctuation / smart formatting              | Whisper produces punctuated text natively                                                                                         | ✅ Comparable                                                                                                                                                                   |
| **Meeting: live multi-speaker diarization** | **Not native** — needs a separate VAD + speaker-embedding pipeline (e.g. pyannote / whisper-diarization), heavy and offline-batch | 🔴 **Gap.** For the 2-channel case we can still label **"You" (mic)** vs **"Other" (system)** by transcribing channels separately, but per-speaker IDs within the room are lost |
| Meeting: system-audio capture               | Unchanged (`getDisplayMedia` loopback) — just route PCM to whisper instead of Deepgram                                            | ✅ Reuse existing                                                                                                                                                               |

**Near-real-time strategy:** Whisper is a 30 s-context chunk model, so "streaming" is a sliding
window. Prefer **VAD-segmented chunks** (whisper.cpp's built-in Silero `--vad`, segment on silence
~5–30 s) over the naive `whisper-stream` sliding window (which also pulls in SDL2) — better quality,
less compute, fewer silence hallucinations. On Apple Silicon + Metal this runs well above realtime.

**Conclusion:** ship **voice-mode local first** (full parity, biggest savings). For meetings, offer
local as a **"private, no-diarization"** option, and keep Deepgram as the default when the user wants
speaker labels.

---

## 9. Productization & tiering — who gets which engine

The economically obvious move — **"local for free, Deepgram for paid"** — is sound on cost (local is
$0/min, so it makes the free tier sustainable at any volume) but blunt: free users are the conversion
funnel, local quality is hardware-dependent, and local meetings lose diarization (§8). Default by
**feature, not by tier**, and meter the premium path.

**Defaults**

| Feature                        | Default engine                                                    | Free                                                                                                 | Paid                                       |
| ------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Voice input (push-to-talk)** | **Local (whisper.cpp)** for everyone, where the device is capable | Local, unlimited                                                                                     | Local by default; cloud available          |
| **Meeting transcription**      | **Deepgram** (diarization + multi-speaker system audio)           | Cloud up to a monthly quota (e.g. a few hours) → then **local "no-diarization"** fallback, unlimited | Unlimited cloud                            |
| **Offline / privacy mode**     | Local                                                             | available                                                                                            | available (some users pay _for_ on-device) |

**Principles**

1. **Per-feature, not per-tier.** Voice input is near-parity and the highest-volume cost → default it
   to local for _all_ users (the cheap path is also the good path here). Meetings need diarization →
   default to cloud, but cap free usage.
2. **Give free users a taste of premium, with a cap.** A small monthly cloud quota for meetings makes
   the first impression great (a conversion driver) while bounding cost; local makes the free tier
   _unlimited_ once the quota is spent.
3. **Local is a feature, not a downgrade.** Market it as "on-device · private · offline · unlimited,"
   and offer it to _paid_ users too as a privacy/offline mode (some users pay specifically for
   on-device).
4. **Gate local on device capability.** Detect Apple Silicon / a capable CPU / an available iGPU;
   don't auto-default a weak CPU-only machine into a slow local experience — prefer cloud-with-quota
   (or a smaller model) there, and always show which engine is active and why.
5. **Keep BYOK.** Free/power users can plug in their own Deepgram key for unlimited cloud at their own
   cost (already supported via `~/.rowboat/config/deepgram.json`).
6. **Make the default remote-configurable.** Whatever we ship first is a hypothesis — A/B
   "free → local" vs "free → cloud-quota-then-local" against activation/conversion and flip it without
   a release.

**Net:** free stays $0-cost and unlimited (local), paid gets the premium cloud experience, and we
don't sacrifice top-of-funnel quality or the privacy angle to get there.

---

## 10. Risks & mitigations

- **CPU/battery & cold-start.** First call loads the model (~100s of ms–seconds); inference uses
  cores. → Keep a warm `whisper-cli` server process or preload the model; default to a small model;
  let users pick.
- **Accuracy vs cloud.** `base.en` is good for dictation, weaker on accents/noise than nova-3. →
  Offer `small`/`large` tiers; keep Deepgram as fallback.
- **Native binary distribution.** Signing/notarization per arch; Windows/Linux GPU variance. → Build
  - sign in CI; default to CPU; treat GPU as best-effort.
- **Model download UX.** 80 MB–3 GB downloads, checksum/verify, resumable. → Reuse the existing
  catalog-download pattern; show size + progress; never block the app.
- **Streaming latency for meetings.** → Chunk (5–10 s) + lightweight VAD; accept higher latency than
  Deepgram; document it.

---

## 11. Phased plan

| Phase                          | Scope                                                                                                                                              | Effort     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **P0 — Spike**                 | Build/obtain `whisper-cli` for mac arm64; `whisper.ts` `transcribe(wav)`; CLI smoke from main; confirm RTF/quality on `base.en`                    | ~2–3 days  |
| **P1 — Voice mode (local)**    | Model manager + download UX; IPC; provider toggle; `useVoiceMode` whisper branch (batch on submit); settings UI; package + sign binary (mac first) | ~1–2 weeks |
| **P2 — Meetings (local)**      | Chunked near-real-time + VAD; per-channel "You/Other" labels; reuse system-audio capture; document the diarization tradeoff                        | ~1–2 weeks |
| **P3 — Polish/cross-platform** | Windows/Linux binaries + signing; Core ML model on Apple Silicon; model tiers; warm-process optimization                                           | ongoing    |

---

## 12. Concrete integration points (files)

- **New:** `apps/x/packages/core/src/voice/whisper.ts` (model manager + `transcribe`), `whisper`
  binaries under `apps/x/apps/main/resources/whisper/`.
- **Edit:** `apps/x/apps/main/src/ipc.ts` + `apps/x/packages/shared/src/ipc.ts` (whisper IPC channels),
  `forge.config.cjs` (`asarUnpack` + sign the binary), `apps/x/packages/core/src/voice/voice.ts`
  (extend `VoiceConfig`/`getVoiceConfig` with `transcription.provider` + whisper model),
  `apps/x/apps/renderer/src/hooks/useVoiceMode.ts` & `useMeetingTranscription.ts` (provider branch),
  `apps/x/apps/renderer/src/components/settings-dialog.tsx` (Transcription settings).

---

## 13. Sources

**whisper.cpp:** [repo](https://github.com/ggml-org/whisper.cpp) ·
[README](https://github.com/ggml-org/whisper.cpp/blob/master/README.md) ·
[models/README (sizes)](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md) ·
[LICENSE (MIT)](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE) ·
[releases](https://github.com/ggml-org/whisper.cpp/releases) ·
[Silero VAD support (#3003)](https://github.com/ggml-org/whisper.cpp/issues/3003) ·
[HF model weights](https://huggingface.co/ggerganov/whisper.cpp/tree/main).
**Node bindings:** [nodejs-whisper](https://github.com/ChetanXpro/nodejs-whisper) ·
[smart-whisper](https://github.com/JacobLinCool/smart-whisper) ·
[@kutalia/whisper-node-addon](https://github.com/Kutalia/whisper-node-addon) ·
[whisper-node (abandoned)](https://github.com/ariym/whisper-node).
**Electron packaging:** [native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules) ·
[Forge auto-unpack-natives](https://www.electronforge.io/config/plugins/auto-unpack-natives).
**Benchmarks:** [Apple Silicon Whisper perf](https://www.voicci.com/blog/apple-silicon-whisper-performance.html) ·
[M3/M4 benchmark](https://justvoice.ai/blog/whisper-benchmark-apple-silicon-m3-m4) ·
[whisper.cpp 1.8.3 iGPU 12×](https://www.phoronix.com/news/Whisper-cpp-1.8.3-12x-Perf) ·
[OpenBenchmarking whisper-cpp](https://openbenchmarking.org/test/pts/whisper-cpp).
**Pricing:** [Deepgram pricing breakdown](https://deepgram.com/learn/speech-to-text-api-pricing-breakdown-2025) ·
[Best STT APIs 2026](https://deepgram.com/learn/best-speech-to-text-apis-2026) ·
[STT APIs 2026 pricing guide](https://futureagi.com/blog/speech-to-text-apis-in-2026-benchmarks-pricing-developer-s-decision-guide/).

**Caveats flagged by the research:** exact latest patch (~v1.8.6) is from a generated release
summary; `base.en-q5_0 ≈ 150 MB` is a secondary-source figure (official table lists unquantized
`base` at 142 MiB); CPU realtime factors are rough and hardware-dependent; `@kutalia` streaming at
production scale is unverified given the project's small size.
