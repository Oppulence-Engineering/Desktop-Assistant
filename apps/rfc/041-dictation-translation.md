# RFC 041: Dictation Translation — Speak One Language, Paste Another

|                    |                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------- |
| **RFC**            | 041                                                                                           |
| **Status**         | Draft                                                                                         |
| **Track**          | Desktop voice surface — OpenWhispr parity                                                     |
| **Owners**         | `apps/x` desktop, core voice, product                                                         |
| **Created**        | 2026-08-12                                                                                    |
| **Depends on**     | [RFC 040](./040-dictation-core-ux.md)                                                         |
| **Related**        | [RFC 052](./052-transcription-provider-breadth.md), [RFC 049](./049-i18n-and-localization.md) |
| **Reference impl** | OpenWhispr (MIT) — see §5                                                                     |

## 1. Decision

Add a dedicated hotkey that transcribes speech in the user's spoken language and
pastes the result in a chosen target language. Speaking Spanish into an English
email should produce English at the cursor, in one gesture, with no visible
intermediate step.

This is the highest value-per-line feature in the OpenWhispr set: the transport,
recording, and paste path already exist from RFC 040, so the work is a second
accelerator plus a two-step inference chain.

## 2. Why it is worth doing

It converts our dictation from "types what you said" into "says what you meant
to the person reading". For any non-native English speaker writing English all
day, it removes the translate-copy-paste loop entirely. It also composes with
RFC 042: the same chain shape (capture → transform → replace) is reused.

## 3. Design

### 3.1 The chain

Two ordered inference steps, each independently skippable:

1. **Cleanup** (optional) — the existing polish pass in
   `apps/x/apps/main/src/dictation-polish.ts`.
2. **Translate** — target language from settings, source usually `auto`.

Critical rule, learned from the reference implementation: **skip the translate
step only when an explicit source language equals the target.** When source is
`auto` or empty, always translate; auto-detect cannot be trusted to prove the
languages already match.

The chain must soft-fail. If cleanup fails, fall through with the raw
transcript; never lose the user's words to a failed enhancement step. Track two
independent booleans: whether cloud reasoning actually ran (for privacy
reporting per RFC 014) and whether the output genuinely reached the target
language (for the UI to avoid claiming a translation that did not happen).

### 3.2 Surfaces

- New accelerator registered through the RFC 040 hotkey registry.
- Target language selector in
  `apps/x/apps/renderer/src/components/settings/transcription-settings.tsx`.
- Provenance: the dictation history entry records source language, target
  language, and whether the translation step ran.

### 3.3 Model routing

Route through the existing model gateway (`packages/core/src/models/gateway.ts`)
rather than a dedicated translation provider. Translation quality from a
general chat model is sufficient and avoids a new vendor.

## 4. Definition of done

- A dedicated hotkey produces translated text at the cursor.
- Explicit source equal to target skips the translate call; `auto` never does.
- Cleanup failure degrades to the raw transcript rather than an error toast.
- History and provenance record both languages and whether translation ran.
- Unit tests cover the skip matrix (`auto`/equal/different) and both soft-fail
  paths, mirroring the reference implementation's pure-function test seams.

## 5. OpenWhispr code references

| Concern             | File                                                       | Lines | Notes                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chain orchestration | `src/helpers/translationChain.js`                          | 68    | Deliberately dependency-free and injectable: `shouldRunTranslateStep()` and `executeTranslationChain()`. Read this first; it is small and near-directly portable to TypeScript. |
| Inference wiring    | `src/helpers/dictationTranslationInference.js`             | 70    | How the chain is bound to a real model call.                                                                                                                                    |
| Routing decisions   | `src/helpers/dictationRouting.js`                          | 171   | Chooses local vs cloud per step, which we map onto our gateway.                                                                                                                 |
| Settings UI         | `src/components/settings/DictationTranslationSettings.tsx` | —     | Language picker and copy.                                                                                                                                                       |
| Language metadata   | `src/utils/languageSupport.ts`                             | —     | Language list and per-engine support matrix.                                                                                                                                    |
| Script handling     | `src/utils/chineseScript.js`                               | —     | Simplified/traditional selection; the kind of detail that generates bug reports if missed.                                                                                      |

MIT-licensed; carry the notice on any adapted file.

## 6. Risks

- Auto-detection on short utterances is unreliable. Prefer an explicit source
  language setting with `auto` as the default, and never silently claim a
  translation occurred when the model returned the input unchanged.
- Cloud translation of dictated text is a privacy surface. It must respect the
  same local-only setting that governs transcription.
