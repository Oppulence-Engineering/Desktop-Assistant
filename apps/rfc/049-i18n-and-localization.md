# RFC 049: Internationalization and Localization

|                    |                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| **RFC**            | 049                                                                                             |
| **Status**         | Draft                                                                                           |
| **Track**          | Reach — OpenWhispr parity                                                                       |
| **Owners**         | `apps/x` renderer, `apps/rowboat-www`, product                                                  |
| **Created**        | 2026-08-12                                                                                      |
| **Depends on**     | —                                                                                               |
| **Related**        | [RFC 041](./041-dictation-translation.md), [RFC 046](./046-windows-linux-native-voice-stack.md) |
| **Reference impl** | OpenWhispr (MIT) — see §5                                                                       |

## 1. Decision

Externalize all user-facing strings and ship localized builds. The reference
implementation ships 10 locales (de, en, es, fr, it, ja, pt, ru, zh-CN, zh-TW); we support
English only, with strings hardcoded inline throughout the renderer.

## 2. Why now rather than later

i18n cost scales with the number of hardcoded strings, and that number only
grows. Doing it after RFCs 040 through 047 add several new settings surfaces
means paying meaningfully more. The right moment to externalize strings is
before a wave of UI work, not after it.

There is also a product argument specific to us: dictation and meeting
transcription are inherently multilingual. A user dictating German into a
purely English UI is a visible mismatch, and RFC 041's translation feature makes
that mismatch sharper.

## 3. Scope

1. **String externalization** — extract every user-facing string in
   `apps/x/apps/renderer/src` into namespaced resource files.
2. **Runtime** — i18next with React bindings, locale detected from the OS with a
   manual override in settings.
3. **Formatting** — dates, times, durations, numbers, and currency through
   `Intl`, not hand-rolled formatters. Our meeting and relationship surfaces are
   full of dates.
4. **Main process** — errors and tray/menu strings also need translation; they
   live outside React.
5. **Prompt locale** — separate from UI locale. Summaries and notes should follow
   a user-chosen content language, which is not necessarily the interface
   language. The reference implementation splits `translation.json` from
   `prompts.json` for exactly this reason, and that split is worth copying.
6. **CI enforcement** — a check that fails when a locale is missing keys or when
   a new hardcoded string is introduced.

## 4. Definition of done

- No user-facing hardcoded strings remain in the renderer (enforced by lint).
- At least English plus two additional locales ship complete.
- Locale follows the OS by default and can be overridden.
- All dates, durations, and numbers use `Intl`.
- Prompt/content language is configurable independently of UI language.
- CI fails on missing or orphaned translation keys.

## 5. OpenWhispr code references

| Concern           | File                                                                                                       | Lines | Notes                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------ |
| i18n bootstrap    | `src/i18n.ts`                                                                                              | 103   | Detection, fallback chain, and resource loading. Small and directly portable.        |
| Resource layout   | `src/locales/<locale>/`                                                                                    | —     | Each locale has `translation.json` and `prompts.json`. The UI/prompt split of §3.5.  |
| Locale registry   | `src/locales/translations.ts`                                                                              | 23    | Locale list and metadata.                                                            |
| Main-process i18n | `src/helpers/i18nMain.js`                                                                                  | —     | Translating outside React, per §3.4.                                                 |
| CI enforcement    | `scripts/check-i18n.js`                                                                                    | 92    | Missing/orphaned key detection. Copy this early; it is what keeps i18n from rotting. |
| Date formatting   | `src/utils/dateFormatting.ts`, `dateGrouping.ts`, `formatDuration.ts`, `formatAmount.ts`, `formatBytes.ts` | —     | Locale-aware formatting helpers.                                                     |
| Language metadata | `src/utils/languageSupport.ts`                                                                             | —     | Shared with RFC 041.                                                                 |

MIT-licensed; carry the notice on any adapted file.

## 6. Risks

- Externalizing strings touches nearly every renderer file and will conflict with
  concurrent UI work. Sequence it as a single focused change, not a slow drip.
- Machine-translated UI copy in a product about language quality is a bad look.
  Budget for human review of at least the onboarding and settings surfaces.
