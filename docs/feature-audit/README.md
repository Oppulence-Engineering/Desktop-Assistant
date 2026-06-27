# Feature Audit — Rowboat Desktop (`apps/x`)

This directory holds the **single canonical feature tracker** for the Rowboat
Electron desktop app and the artifacts produced while testing and hardening it.

## Files

| File                | Purpose                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FEATURE_AUDIT.csv` | **THE canonical spreadsheet.** One row per user-facing feature/sub-feature, with a user story + the expected behavior derived from the code, plus lifecycle columns. |
| `ERRORS.md`         | Catalogue of logistical/UX errors found while testing each user story (Phase 2), with severity, evidence, and proposed fix.                                          |
| `README.md`         | This file.                                                                                                                                                           |

## `FEATURE_AUDIT.csv` columns

- **ID** — stable `F###` identifier.
- **Area** — feature cluster (Chat, Editor, Live Notes, Meetings, Email, Bases, Background Tasks, Coding, Browser, Connectors, Settings, Voice, …).
- **Feature** — short name.
- **User Story** — `As a <user>, I want <goal>, so that <benefit>`.
- **Expected Behavior (from code)** — what the code says should happen.
- **Code Refs** — `file:line` pointers (relative to repo root).
- **Status** — `Documented` → `Tested` → `Bug-Found` / `OK` → `Fixed` → `Verified`.
- **Test Result** — Phase 2 outcome (Pass / Issue / Cannot-verify).
- **Issues Found** — Phase 2 defects (cross-references `ERRORS.md` IDs).
- **Fix Applied** — Phase 3 change summary.
- **Re-test Result** — Phase 4 outcome.

## Lifecycle (the goal this tracker serves)

1. **Enumerate** every feature → user story + expected behavior (canonical CSV). ✅ — 530 user stories across 39 areas.
2. **Test** every user story; document all errors in `ERRORS.md` and the CSV. ✅ — 62 substantiated defects (3 High, 31 Medium, 28 Low).
3. **Fix** every logistical / UX error. ✅ — 56 fixed; 6 Deferred (documented product decisions). Full `check:types` build passes with 0 errors.
4. **Re-test** every user behavior post-fix. ✅ — all 56 fixes adversarially re-verified against the post-fix code (2 regressions caught, re-fixed, re-verified); build green.

### Status snapshot (current)

- Feature rows: **530** — 55 Verified, 6 Deferred, 469 Tested/Pass.
- Issues: **62** — Verified 56, Deferred 6, Open 0.
- Build: `cd apps/x && npm run check:types` → 0 errors (renderer `tsc -b` + vite, core, main process).

The 6 **Deferred** issues (E42, E43, E47, E48, E55, E56) are unreachable/unshipped feature surfaces or a false-provenance beta toggle. The correct resolution is a product call (wire up the whole surface vs. remove intentional WIP), so they are documented rather than silently changed.

## Method note

The app is an Electron desktop app whose features are exercised through a GUI.
Phase 2 "testing" is performed as a **code-level behavioral audit**: each user
story is traced through its renderer component, IPC channel, and core logic to
confirm the expected behavior actually holds, surfacing broken wiring, state
bugs, race conditions, missing error handling, and UX gaps. Findings carry
`file:line` evidence so they are independently checkable.
