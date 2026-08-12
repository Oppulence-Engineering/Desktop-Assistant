# RFC 052: Transcription Provider Breadth

|                    |                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------- |
| **RFC**            | 052                                                                                           |
| **Status**         | Draft                                                                                         |
| **Track**          | Transcription — OpenWhispr parity                                                             |
| **Owners**         | `apps/x` core voice, platform                                                                 |
| **Created**        | 2026-08-12                                                                                    |
| **Depends on**     | [RFC 009](./complete-009-local-on-device-transcription.md)                                    |
| **Related**        | [RFC 043](./043-gpu-whisper-and-parakeet-engines.md), [RFC 050](./050-enterprise-controls.md) |
| **Reference impl** | OpenWhispr (MIT) — see §6                                                                     |

## 1. Decision

Broaden transcription beyond our current provider set, and make the provider
layer pluggable enough that adding one is a small, well-understood change rather
than a fork of the pipeline.

## 2. Current state

`packages/shared/src/transcription.ts` defines the whole universe:

```ts
export const TranscriptionProvider = z.enum(["solomon", "deepgram", "whisper-local", "none"]);
```

Routing lives in `packages/core/src/voice/voice.ts` (`deepgram` is the
signed-out default, `solomon` when signed in) behind a capability gate that
downgrades or upgrades the choice. The abstraction is sound; it is just narrow.

The reference implementation supports Deepgram, AssemblyAI, Corti, OpenAI
Realtime, Tinfoil, local Whisper, local Parakeet, and a self-hosted shim.

## 3. What breadth actually buys

Not novelty. Three concrete things:

1. **Failure isolation.** When Deepgram has an incident, a second streaming
   provider is the difference between degraded and down.
2. **Procurement.** Enterprise buyers frequently have an existing contract or a
   banned vendor list. A self-hosted or BYO-endpoint option closes deals that
   provider quality never will.
3. **Specialization.** Corti is medical-domain; Tinfoil is confidential-compute.
   These matter for specific verticals and not at all otherwise.

Breadth for its own sake is a maintenance liability. Each provider is an API
that will change, a credential to store, and a set of error cases to normalize.
Add providers with a reason attached.

## 4. Design

### 4.1 Provider interface

Formalize the contract every provider implements: streaming and batch,
word-level timestamps, optional diarization hints, language selection,
cancellation, and a normalized error taxonomy. The last one is the most
valuable: today every provider fails differently and the UI cannot reason about
it.

### 4.2 Priority order

1. **Self-hosted / OpenAI-compatible endpoint** — highest strategic value, least
   ongoing maintenance, unblocks enterprise and privacy buyers.
2. **AssemblyAI** — a credible second streaming provider for failover.
3. **OpenAI Realtime** — low incremental cost where we already hold credentials.
4. **Corti, Tinfoil** — only with a named customer requirement.

### 4.3 Routing and fallback

Extend the existing capability-based routing rather than replacing it:
user override, then org policy (RFC 050 can restrict the allowed set), then
remote default, then capability fallback. Fallback must be visible in
provenance (RFC 014) so a user is never silently moved to a different provider,
especially one with different data-handling properties.

### 4.4 Credentials

Per-provider keys in the OS keychain, never in plain config. Org-managed
providers (RFC 050) bypass user keys entirely.

## 5. Definition of done

- A documented provider interface with at least three implementations behind it.
- A self-hosted/OpenAI-compatible endpoint is configurable by a user with no
  code change, with a worked example.
- Provider failure falls back automatically, with the substitution visible in
  provenance.
- Errors are normalized into a taxonomy the UI can act on.
- Keys are stored in the keychain; policy can restrict the selectable set.

## 6. OpenWhispr code references

| Provider / concern   | File                                                                                           | Lines | Notes                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deepgram streaming   | `src/helpers/deepgramStreaming.js`                                                             | 907   | Reconnection, keepalive, and finalization — the parts that make streaming hard.                                                                   |
| AssemblyAI streaming | `src/helpers/assemblyAiStreaming.js`                                                           | 632   | The §4.2 priority-2 provider.                                                                                                                     |
| OpenAI Realtime      | `src/helpers/openaiRealtimeStreaming.js`                                                       | 513   | Realtime API session handling.                                                                                                                    |
| Corti                | `src/helpers/cortiStreaming.js`, `cortiTranscription.js`, `cortiAuth.js`                       | 506   | Includes a non-trivial auth flow.                                                                                                                 |
| Tinfoil              | `src/helpers/tinfoilRealtimeStreaming.js`, `tinfoilTranscription.js`, `tinfoilSecureClient.js` | 236   | Confidential-compute attestation is the interesting part.                                                                                         |
| Self-hosted shim     | `src/helpers/selfHostedTranscription.js` + `examples/custom-asr-shim/`                         | 18    | Tiny host side plus a worked example project. Exactly the §4.2 priority-1 pattern.                                                                |
| Routing              | `src/helpers/transcriptionRoute.ts`                                                            | 302   | Provider selection logic.                                                                                                                         |
| Fallback             | `src/helpers/transcriptionFallback.js`                                                         | 11    | Small but load-bearing.                                                                                                                           |
| Auth                 | `src/helpers/transcriptionAuth.js`                                                             | —     | Per-provider credential handling.                                                                                                                 |
| Timeouts             | `src/helpers/transcriptionTimeout.js`                                                          | —     | Per-provider timeout tuning.                                                                                                                      |
| Provider registry    | `src/services/ai/inferenceProviders/`                                                          | —     | `anthropic, corti, enterprise, gemini, groq, lan, local, openai, openwhispr, tinfoil` behind one `types.ts`. The registry shape to copy for §4.1. |
| Error normalization  | `src/services/ai/apiErrorMessage.ts`                                                           | —     | User-facing error mapping.                                                                                                                        |

MIT-licensed; carry the notice on any adapted file.

## 7. Risks

- Every provider is permanent maintenance. Require a stated reason per provider
  and be willing to remove unused ones.
- Providers differ in data retention and training policy. Provenance must record
  which provider handled which audio, or our privacy claims become unverifiable.
