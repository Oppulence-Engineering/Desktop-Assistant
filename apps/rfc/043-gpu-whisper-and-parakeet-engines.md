# RFC 043: GPU-Accelerated Local Whisper and the Parakeet Engine Question

|                    |                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------- |
| **RFC**            | 043                                                                                         |
| **Status**         | Draft                                                                                       |
| **Track**          | Local inference — OpenWhispr parity                                                         |
| **Owners**         | `apps/x` core voice, native, release engineering                                            |
| **Created**        | 2026-08-12                                                                                  |
| **Depends on**     | [RFC 009](./complete-009-local-on-device-transcription.md)                                  |
| **Related**        | [RFC 046](./046-windows-linux-native-voice-stack.md), [RFC 053](./053-local-llm-runtime.md) |
| **Reference impl** | OpenWhispr (MIT) — see §6                                                                   |

## 1. Decision

Ship GPU-accelerated local Whisper on Windows and Linux (CUDA and Vulkan) and
keep Parakeet as our fast engine, resolving the engine question explicitly
rather than by accident.

## 2. Correcting a common misreading

**We already have Parakeet.** `apps/x/vendor/audiocap/Sources/audiocap/ParakeetEngine.swift`
runs Parakeet TDT 0.6B through FluidAudio's Core ML port (`Package.swift` pins
`FluidInference/FluidAudio` 0.15.0), with `ParakeetServer.swift` and
`apps/main/src/parakeet-dictation-runner.ts` on top. Our implementation is
roughly an order of magnitude faster than whisper.cpp on Apple silicon because
it runs on the Neural Engine.

The reference implementation reaches Parakeet differently, via **sherpa-onnx**.
That distinction is the whole point of this RFC:

|             | Ours (FluidAudio Core ML)  | Theirs (sherpa-onnx)                           |
| ----------- | -------------------------- | ---------------------------------------------- |
| Platforms   | macOS only (Apple silicon) | macOS, Windows, Linux                          |
| Accelerator | Neural Engine              | CPU/GPU via ONNX Runtime                       |
| Intel Mac   | No                         | No (ONNX Runtime dropped macOS x86_64 in 1.24) |

So the gap is **not Parakeet**. It is that our fast engine does not exist off
Apple silicon, and our local Whisper has no GPU path anywhere.

## 3. What we have

- `packages/core/src/voice/whisper/` — `service.ts`, `runner.ts` (428),
  `model-manager.ts` (703), `capability.ts` (149), `benchmark.ts`,
  `streaming.ts`, `wer.ts`, plus an eval suite. This is a mature module.
- `capability.ts` already models a hardware-acceleration backend from a
  capability probe (RFC 009 §13), so the abstraction point exists.

## 4. Proposed work

### 4.1 GPU whisper binaries

Ship per-backend whisper.cpp builds and select at runtime:

- **Metal** — macOS (already effectively covered).
- **CUDA** — NVIDIA on Windows/Linux, gated on driver detection.
- **Vulkan** — AMD/Intel GPUs, the broad fallback.

This needs a binary manager that resolves the right build per machine, verifies
checksums (we have `whisper/checksums.ts`), and falls back to CPU cleanly when
a GPU init fails at runtime rather than at download time.

### 4.2 Parakeet beyond Apple silicon

Add a sherpa-onnx-backed Parakeet runner as a **second implementation behind our
existing engine interface**, used on Windows/Linux while macOS keeps FluidAudio.
Do not replace the Core ML path: it is faster on the platform where most of our
users are.

### 4.3 Honest capability reporting

The capability probe must report which backend actually initialized, not which
was requested, and the UI must show it. A user who thinks they are on GPU but
silently fell back to CPU will file a performance bug we cannot reproduce.

## 5. Definition of done

- Local Whisper uses CUDA or Vulkan when available on Windows/Linux, with
  measured speedup recorded in the existing benchmark harness.
- GPU init failure falls back to CPU within one session, surfaced to the user.
- Parakeet is available on Windows/Linux via sherpa-onnx behind the same
  interface, with the macOS Core ML path unchanged.
- Download size impact is measured and stated; GPU binaries are fetched on
  demand, not bundled into every installer.

## 6. OpenWhispr code references

| Concern              | File                                                                      | Lines           | Notes                                                                                           |
| -------------------- | ------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| GPU binary selection | `src/helpers/gpuBinaryManager.js`                                         | 246             | Resolving and caching per-backend binaries. The core of §4.1.                                   |
| CUDA detection       | `src/helpers/whisperCudaManager.js` + `src/utils/gpuDetection.js`         | 73 / 90         | Driver and capability probing.                                                                  |
| Vulkan detection     | `src/helpers/whisperVulkanManager.js` + `src/utils/vulkanDetection.js`    | 39 / 61         | The AMD/Intel path.                                                                             |
| Whisper server       | `src/helpers/whisperServer.js`                                            | 1022            | Long-lived server process rather than per-utterance spawn; relevant to our `runner.ts` latency. |
| Whisper core         | `src/helpers/whisper.js`                                                  | 869             | Model lifecycle and invocation.                                                                 |
| VAD config           | `src/helpers/whisperVadConfig.js`                                         | 41              | Voice-activity settings that cut wasted decode time.                                            |
| Parakeet via sherpa  | `src/helpers/parakeet.js`, `parakeetServer.js`, `parakeetWsServer.js`     | 664 / 229 / 566 | The cross-platform Parakeet path for §4.2.                                                      |
| Binary downloads     | `scripts/download-whisper-cpp.js`, `scripts/download-sherpa-onnx.js`      | — / 324         | Per-platform download and `--all` prefetch for CI.                                              |
| Sidecar hygiene      | `src/helpers/sidecarPidFile.js`, `sidecarReaper.js`, `sidecarRegistry.js` | —               | Preventing orphaned inference processes. We will need this once we run long-lived servers.      |

MIT-licensed; carry the notice on any adapted file.

## 7. Risks

- Installer size and build-matrix complexity grow fast. Fetch GPU binaries on
  demand and keep CPU as the always-present baseline.
- GPU driver variance is the single largest source of hard-to-reproduce crashes
  in this space. Every GPU path must be able to fail back to CPU at runtime.
