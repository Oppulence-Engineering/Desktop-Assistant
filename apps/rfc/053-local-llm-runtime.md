# RFC 053: Local Relationship-Inference Runtime and Quality Gates

|                |                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RFC**        | 053                                                                                                                                                                            |
| **Status**     | Draft — rescoped by RFC 055; local embeddings and Ollama provider support are already partial                                                                                  |
| **Track**      | Local relationship intelligence · sovereign execution                                                                                                                          |
| **Owners**     | `packages/core`, `apps/x`, relationship state, model platform                                                                                                                  |
| **Created**    | 2026-08-12                                                                                                                                                                     |
| **Updated**    | 2026-08-21                                                                                                                                                                     |
| **Depends on** | [RFC 021](./complete-021-semantic-memory-index.md), [RFC 036](./036-relationship-state-engine.md)                                                                              |
| **Related**    | [RFC 014](./014-live-note-observability-cost-and-provenance.md), [RFC 050](./050-enterprise-controls.md), [RFC 055](./055-capture-product-boundary-and-rowboat-integration.md) |

## 1. Decision

Provide an honest local execution path for Rowboat's relationship inference:
retrieval, evidence extraction, relationship projection, and low-risk drafting.
Capture-model installation, transcription engines, and capture-note utilities
belong to the capture product.

Local execution never lowers provenance, identity, or action-governance
requirements. A weak local model may abstain; it may not silently create
low-confidence relationship claims or execute external actions.

## 2. Existing foundation

Rowboat already has:

- local BM25 and embedding-backed semantic memory under RFC 021;
- an Ollama model provider;
- a managed macOS Ollama runtime used by local embeddings;
- model/provider routing; and
- relationship evidence and projection contracts.

The gap is a supported, end-to-end local generation profile with capability
tests, resource management, and relationship-specific quality gates.

## 3. Capability profiles

The runtime reports capabilities rather than a single `local = true` flag:

```text
LocalCapabilities
├── embeddings
├── semantic_retrieval
├── structured_extraction
├── relationship_projection
├── summarization
├── drafting
├── vision_context
└── max_context_tokens
```

Each capability is enabled only after a model-specific evaluation passes. The
UI explains when a task requires a configured cloud/BYO provider or is
unavailable locally.

## 4. Relationship quality gates

Local extraction and projection must:

- cite exact source spans;
- validate structured output against the same schemas as cloud execution;
- preserve uncertainty and contradictions;
- abstain when identity or evidence confidence is insufficient;
- pass a relationship-specific fixture suite; and
- emit provider, model, prompt, latency, and quality provenance.

Action tools remain propose-only and follow RFC 023 regardless of model
location.

## 5. Runtime and resource discipline

- Detect memory, architecture, acceleration, and available disk before download.
- Offer model sizes appropriate to the device and explain trade-offs.
- Verify model hashes and licenses.
- Start inference services on demand and stop them after inactivity.
- Enforce one owner for downloads, updates, health checks, and cleanup.
- Never let Rowboat and the capture product independently download duplicate
  large models when a secure, versioned shared-runtime option is available.
- Treat shared-runtime access as an API boundary, not a shared writable model
  directory.

## 6. Privacy boundary

Local relationship processing consumes only artifacts the user has authorized
for Rowboat. The existence of local capture data does not grant Rowboat access
to the capture product's database or raw audio.

If a task falls back from local to cloud, the transition is explicit and shows
which context will leave the device. Organization policy may forbid fallback.

## 7. Definition of done

- A supported local model can complete the approved relationship fixture suite.
- Capability reporting is truthful per model and device.
- Every local claim retains exact evidence and model provenance.
- Low-confidence extraction abstains instead of entering graph state.
- Cloud fallback is explicit, policy-aware, and fail-closed.
- External actions remain governed identically under local and cloud models.
- Capture transcription/model management is absent from Rowboat's scope.
