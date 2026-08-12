# RFC 047: Snippets, Custom Vocabulary, and the Correction Learner

|                    |                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| **RFC**            | 047                                                                                              |
| **Status**         | Draft                                                                                            |
| **Track**          | Dictation accuracy — OpenWhispr parity                                                           |
| **Owners**         | `apps/x` core voice, renderer, product                                                           |
| **Created**        | 2026-08-12                                                                                       |
| **Depends on**     | [RFC 040](./040-dictation-core-ux.md)                                                            |
| **Related**        | [RFC 029](./029-founder-operating-memory.md), [RFC 021](./complete-021-semantic-memory-index.md) |
| **Reference impl** | OpenWhispr (MIT) — see §6                                                                        |

## 1. Decision

Give users direct control over transcription accuracy through three linked
features: a **custom dictionary** for terms the model gets wrong, **snippets**
for spoken shorthand that expands to canonical text, and a **correction
learner** that proposes dictionary entries by observing what users fix by hand.

## 2. Why

Transcription accuracy on generic speech is largely a solved commodity. What is
not solved is _your_ vocabulary: colleague names, product names, company jargon,
acronyms. "Oppulence" transcribed as "opulence" every single time is the kind of
small, constant friction that makes people stop using a dictation product.

The correction learner is the differentiated piece. Most products make you
maintain the dictionary manually; almost nobody notices that you have fixed the
same word eleven times and offers to fix it permanently.

## 3. What we have

Our config schema **already models this**. From
`packages/core/src/voice/transcription-config.test.ts`, the test is named
"persists local dictation context, styles, dictionary, and snippets", and line
160 shows the shape:

```ts
dictionary: [{ term: "Oppulence", replacementFor: "opulence", starred: true }];
```

So the data model and persistence exist in `packages/core/src/voice/voice.ts`.
What is missing is:

1. Any UI to manage dictionary entries or snippets.
2. Application of the dictionary to local (Whisper/Parakeet) transcription.
3. The correction learner entirely.

This makes RFC 047 unusually cheap: it is mostly surfacing something we built.

## 4. Design

### 4.1 Dictionary application

Two application points, because they behave differently:

- **Cloud/prompted engines** — pass terms as an initial prompt or vocabulary
  hint. Watch the token budget; a large dictionary degrades quality.
- **Local engines and post-processing** — apply `replacementFor → term`
  substitution with word-boundary and case-preserving rules.

`starred` entries take priority when the budget forces a subset.

### 4.2 Echo filtering

A dictionary term that appears in the prompt can be echoed by the model into the
transcript even when unspoken. This must be filtered; the reference
implementation has a dedicated module for exactly this failure.

### 4.3 Snippets

Spoken trigger expands to stored text ("my address" → the full address). These
are text macros, evaluated after transcription and before paste. They must not
apply inside a selection edit (RFC 042), where the user's words are an
instruction rather than content.

### 4.4 Correction learner

Observe post-dictation edits. When the same substitution recurs above a
threshold, **propose** a dictionary entry. Never add silently: a wrong automatic
entry corrupts every future transcript and is very hard for a user to diagnose.

Learning happens on-device from the user's own edits, and the proposal UI must
allow permanent dismissal.

### 4.5 Import/export

Dictionaries are portable assets. Support import/export so a team can share a
product-vocabulary list.

## 5. Definition of done

- Dictionary and snippet management UI exists in settings, backed by the
  existing config.
- Dictionary terms measurably improve accuracy on a fixture set containing
  domain vocabulary, measured with the existing WER harness
  (`packages/core/src/voice/whisper/wer.ts`).
- Prompt echo does not leak unspoken dictionary terms into transcripts (tested).
- The correction learner proposes entries after repeated identical fixes and
  never applies them without confirmation.
- Import/export round-trips.

## 6. OpenWhispr code references

| Concern             | File                                                      | Lines   | Notes                                                                                           |
| ------------------- | --------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| Correction learner  | `src/utils/correctionLearner.js`                          | 179     | The differentiated feature. Detects repeated user corrections and proposes entries. Read first. |
| Dictionary UI       | `src/components/DictionaryView.tsx`                       | 337     | Full management surface.                                                                        |
| Dictionary service  | `src/services/DictionaryService.ts`                       | 62      | Persistence and lookup.                                                                         |
| Prompt echo filter  | `src/utils/dictionaryEchoFilter.js`                       | —       | Solves §4.2 directly; easy to miss until users report phantom words.                            |
| Dictionary startup  | `src/helpers/dictionaryStartup.js`                        | —       | Loading and applying at boot.                                                                   |
| Import              | `src/helpers/dictionaryImport.js`                         | 13      | Import format.                                                                                  |
| Snippets UI         | `src/components/SnippetsView.tsx`                         | 321     | Trigger and expansion management.                                                               |
| Snippet logic       | `src/utils/snippets.ts`, `src/services/SnippetService.ts` | 85 / 72 | Matching and expansion rules.                                                                   |
| Agent name handling | `src/helpers/agentNameDictionary.js`                      | —       | Preventing the assistant's own name from being transcribed into output.                         |
| Auto-learn setting  | `src/helpers/autoLearnSetting.js`                         | —       | The opt-in gate for learning.                                                                   |

MIT-licensed; carry the notice on any adapted file.

## 7. Risks

- A large dictionary consumes prompt budget and can _reduce_ accuracy. Cap it,
  prioritize starred terms, and measure with WER rather than assuming.
- The correction learner reads what users type after dictating. That is
  sensitive. It must be on-device, opt-in, and clearly explained.
