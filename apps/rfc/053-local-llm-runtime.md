# RFC 053: Local LLM Runtime and Local Vector Index

|                    |                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**            | 053                                                                                                                                                            |
| **Status**         | Draft                                                                                                                                                          |
| **Track**          | Local inference — OpenWhispr parity                                                                                                                            |
| **Owners**         | `apps/x` core, platform, release engineering                                                                                                                   |
| **Created**        | 2026-08-12                                                                                                                                                     |
| **Depends on**     | [RFC 021](./complete-021-semantic-memory-index.md)                                                                                                             |
| **Related**        | [RFC 043](./043-gpu-whisper-and-parakeet-engines.md), [RFC 050](./050-enterprise-controls.md), [RFC 014](./014-live-note-observability-cost-and-provenance.md) |
| **Reference impl** | OpenWhispr (MIT) — see §6                                                                                                                                      |

## 1. Decision

Make "no data leaves this machine" a complete, honest configuration by running
text generation locally via a bundled `llama.cpp` server, and by keeping the
semantic index fully local.

## 2. The claim we cannot currently make

We have local transcription (RFC 009) and local diarization (RFC 017), but
summaries, note tagging, commitments extraction, and chat all route through
`packages/core/src/models/gateway.ts` to a cloud model. So a privacy-conscious
user gets local _audio_ handling and cloud _content_ handling.

That is a defensible product position, but it is not the position a
privacy-first buyer is looking for, and it is one that a competitor can attack
directly. Completing the local path closes that gap and, with RFC 050, makes the
regulated-buyer story coherent.

## 3. Scope

### 3.1 Local generation

Bundle or fetch a `llama.cpp` server binary, manage a small model (3B-8B class),
and expose it through the existing gateway as another provider so callers do not
change. GPU acceleration shares the backend detection work from RFC 043.

### 3.2 Honest capability boundaries

A 7B local model will not match a frontier model at meeting summarization or
commitment extraction. Being straightforward about that is the whole game:

- Local mode must state which capabilities are reduced.
- Quality-sensitive features (RFC 035 commitments, RFC 036 state projection)
  should either degrade visibly or decline to run rather than emit low-confidence
  output that enters the relationship graph as fact.
- Provenance (RFC 014) records which model produced each artifact.

The failure mode to avoid is a local model quietly producing worse relationship
claims that users cannot distinguish from good ones.

### 3.3 Local vector index

Our memory index (RFC 021) should have a fully local embedding and search path
so semantic search works offline and under a local-only policy. Embedding
generation is small enough to run on-device comfortably.

### 3.4 Resource discipline

An idle LLM server holding several GB of RAM on a laptop is user-hostile. The
runtime must start on demand, idle-unload after a timeout, refuse to load a
model that exceeds available memory, and never leave an orphan process. Our
existing sidecar patterns and the reference implementation's reaper are the
model here.

## 4. Definition of done

- A user can select local generation and complete a summary end to end with the
  network disabled.
- Semantic search works offline.
- The runtime starts on demand, unloads when idle, and leaves no orphan process
  after a crash (tested by killing the app mid-inference).
- Local mode states which features are reduced; quality-gated features decline
  rather than degrade silently.
- Local-vs-cloud model choice appears in provenance for every generated artifact.
- Model download is on demand, resumable, and checksum-verified.

## 5. OpenWhispr code references

| Concern                | File                                                                       | Lines | Notes                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| Local reasoning bridge | `src/services/localReasoningBridge.js`                                     | 91    | Routing generation to the local server behind the normal interface. The pattern for §3.1.                         |
| Server provisioning    | `scripts/download-llama-server.js`                                         | 235   | Per-platform binary download with a `--current` / `--all` split for CI.                                           |
| Output parsing         | `src/utils/llamaOutputParser.js`                                           | —     | Local models emit messier output; this normalizes it.                                                             |
| Thinking suppression   | `src/services/ai/thinkingSuppression.ts`, `thinkingSuppressionDialects.ts` | —     | Stripping reasoning tokens across model families. Easy to underestimate; every local model does this differently. |
| Reasoning routing      | `src/helpers/reasoningRouting.js`                                          | —     | Local vs cloud decision.                                                                                          |
| Model picker UI        | `src/components/LocalModelPicker.tsx`, `ReasoningModelSelector.tsx`        | —     | Presenting model size/quality/RAM tradeoffs to users.                                                             |
| Vector index           | `src/helpers/vectorIndex.js`                                               | 226   | Local vector search. Shared with RFC 044.                                                                         |
| Qdrant lifecycle       | `src/helpers/qdrantManager.js`                                             | 257   | Managing an embedded vector DB process.                                                                           |
| Embedding model        | `scripts/download-minilm.js`                                               | —     | Local embedding model provisioning for §3.3.                                                                      |
| Process hygiene        | `src/helpers/sidecarPidFile.js`, `sidecarReaper.js`, `sidecarRegistry.js`  | —     | Directly addresses §3.4 orphan prevention.                                                                        |
| GPU detection          | `src/helpers/gpuBinaryManager.js`                                          | 246   | Shared with RFC 043.                                                                                              |

MIT-licensed; carry the notice on any adapted file.

## 6. Risks

- **Installer size.** A bundled server plus model can add gigabytes. Fetch on
  demand; never ship a model in the default installer.
- **Quality regression entering the graph** is the serious risk, not latency. A
  weak local model must not be allowed to write low-confidence claims into
  relationship state.
- Local inference on a battery-powered laptop is a real UX cost. Respect power
  state and let users restrict local generation to AC power.
