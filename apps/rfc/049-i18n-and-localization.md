# RFC 049: Internationalization and Localization

|                    |                                                                      |
| ------------------ | -------------------------------------------------------------------- |
| **RFC**            | 049                                                                  |
| **Status**         | Draft                                                                |
| **Track**          | Rowboat reach · web and desktop localization                         |
| **Owners**         | `apps/x` renderer, `apps/rowboat-www`, product                       |
| **Created**        | 2026-08-12                                                           |
| **Depends on**     | —                                                                    |
| **Related**        | [RFC 055](./055-capture-product-boundary-and-rowboat-integration.md) |
| **Reference impl** | OpenWhispr (MIT) — see §5                                            |

## 1. Decision

Externalize all user-facing strings and ship localized builds. The reference
implementation ships 10 locales (de, en, es, fr, it, ja, pt, ru, zh-CN, zh-TW); we support
English only, with strings hardcoded inline throughout the renderer. The
capture product owns and ships its localization independently.

## 2. Why now rather than later

i18n cost scales with the number of hardcoded strings, and that number only
grows. The right moment to externalize strings is before another wave of
relationship, connector, and collaboration UI work, not after it.

There is also a product argument specific to us: relationships span languages,
regions, currencies, and date conventions. Capture-language and dictation-
translation behavior remain independently owned by the capture product.

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
| Language metadata | `src/utils/languageSupport.ts`                                                                             | —     | Reference for locale metadata; capture translation remains out of Rowboat scope.     |

MIT-licensed; carry the notice on any adapted file.

## 6. Risks

- Externalizing strings touches nearly every renderer file and will conflict with
  concurrent UI work. Sequence it as a single focused change, not a slow drip.
- Machine-translated UI copy in a product about language quality is a bad look.
  Budget for human review of at least the onboarding and settings surfaces.
