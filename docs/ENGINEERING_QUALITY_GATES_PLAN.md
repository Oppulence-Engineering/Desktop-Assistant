# Engineering Quality Gates Plan — Pre-commit Hooks, Performance & Regression Tests

> Status: **Implemented (P0–P3).** Scope: the `apps/x` Electron desktop app primarily, with
> hooks spanning the polyglot monorepo (Go API + perf tool, Next.js web, TS desktop).
> Method: benchmarked against how shipping OSS Electron apps (VS Code, Signal, Element,
> Joplin, Bitwarden, Mattermost, Logseq, Standard Notes) do this, then mapped to what we
> already have. Citations inline.

---

## 0. Implementation status

All phases are landed. Files in parentheses.

- [x] **L0 Foundations** — root tooling package (`package.json`), `.editorconfig`,
      `.prettierrc.json`, `.prettierignore`. Prettier adopted **staged-only / gradual** (double
      quotes + semicolons, the prevailing style — minimal churn).
- [x] **L1 pre-commit** — `lefthook.yml`: Prettier + ESLint `--fix` on staged TS, `gofmt` + `go vet`
      on staged Go. Verified end-to-end.
- [x] **L2 commit-msg** — commitlint (`commitlint.config.cjs`) matching the PR-title types. Verified.
- [x] **L3 pre-push** — renderer `tsc -b` + `apps/x` unit tests (`lefthook.yml`).
- [x] **L3/P3 import boundary** — renderer `no-restricted-imports` rule keeps `@x/core`/`electron`/
      node built-ins out of the browser layer (`apps/x/apps/renderer/eslint.config.js`).
- [x] **L4 PR CI** — `x-smoke-test.yml` reworked: renderer typecheck → lint → unit → package →
      **Playwright-Electron smoke** (`apps/x/apps/main/{playwright.config.ts,e2e/smoke.spec.ts}`)
      replacing the 5s boot.
- [x] **L4 perf-lite** — `scripts/perf-lite.mjs` + `x-perf-lite.yml` (renderer bundle-size budget).
- [x] **L5 perf regression gate** — rolling CI baseline wired into `desktop-perf-nightly.yml`
      (cache + new `ROWBOAT_DESKTOP_PERF_REFRESH_BASELINE_ON_PASS` flag in `tools/desktop-perf`).
- [x] **L5 nightly e2e matrix** — `x-e2e-nightly.yml` (Linux + macOS).
- [x] **Docs** — `CONTRIBUTING.md` "Quality gates" section (setup, `--no-verify`, what runs where).

**One-time setup for contributors:** `pnpm install --ignore-workspace` at the repo root (installs
lefthook/prettier/commitlint and runs `lefthook install`).

---

## 1. TL;DR

1. **We are already ahead on performance.** Our Go-based `tools/desktop-perf` gate (tiered
   budgets, CDP profiling, IPC timing, memory-growth loops, nightly CI) is more sophisticated
   than **7 of the 8** flagship OSS Electron apps surveyed — only Signal Desktop has a
   comparable benchmark suite. **Plan: keep it, add a cheap per-PR "perf-lite" check, and add a
   threshold-based regression gate (the VS Code pattern).**
2. **Our biggest gap is the cheapest to close: no commit-time hooks at all.** No husky / lefthook
   / lint-staged / prettier / commitlint. Lint only runs in CI and manually. **Plan: add a fast,
   staged-only pre-commit hook** (format + lint-fix) — the single highest-leverage change.
3. **Regression testing is thin** (4 vitest unit tests + a 5-second "is it still alive" boot
   smoke). **Plan: add renderer typecheck to CI, grow unit tests, and add a Playwright-Electron
   e2e layer** driving the packaged build via `_electron.launch` — the modern idiom used by
   Signal and Element Desktop.

Effort is phased so **P0 (a week of part-time work) closes the embarrassing gaps**; later phases
are incremental.

---

## 2. Where we are today

### Strengths (keep / build on)
| Area | What exists | Path |
|---|---|---|
| Perf gate | Tiered (commit/full/deep) Go harness: process-tree RSS/CPU sampling, CDP renderer profile + heap/DOM metrics, IPC p50/p95/max, bundle-size budgets, memory-growth loops, machine-local baselines | `tools/desktop-perf/`, `tools/desktop-perf/budget.json` |
| Perf docs | Thorough operator doc | `docs/DESKTOP_PERFORMANCE_GATE.md` |
| Perf CI | Nightly (full tier) + weekly (deep) + manual dispatch, under xvfb on a kind stack | `.github/workflows/desktop-perf-nightly.yml` |
| Perf entrypoints | `make perf-desktop[-full|-deep|-quick|-baseline]` | `Makefile` |
| Lint | ESLint flat config (root + renderer) | `apps/x/eslint.config.mts`, `apps/x/apps/renderer/eslint.config.js` |
| PR-title hygiene | Conventional-commit PR-title check (feat/fix/perf/…) | `.github/workflows/pr-title-lint.yml` |
| Unit tests | vitest, 4 tests in `packages/core` | `apps/x/packages/core/src/**/**.test.ts` |
| Boot smoke (PR) | install → build shared/core/preload → lint → Forge package → launch 5s under xvfb, assert process alive | `.github/workflows/x-smoke-test.yml` |
| Release/build CI | Multi-OS Forge build/publish | `electron-build.yml`, `release.yml`, `x-publish.yml` |

### Gaps (this plan)
| Gap | Impact | Severity |
|---|---|---|
| **No git hooks** (husky/lefthook/lint-staged) | Lint/format errors only caught in CI or never; noisy diffs | 🔴 High |
| **No formatter** (no prettier/editorconfig) | Inconsistent style, churny diffs, format debates | 🔴 High |
| **Renderer typecheck (`tsc -b`) not gated in CI** | `x-smoke-test.yml` builds only shared/core/preload + lints; renderer type errors can merge | 🔴 High |
| **Regression tests thin** (4 unit tests; boot smoke only asserts "process alive 5s") | UI/IPC regressions ship undetected | 🟠 Medium |
| **No Electron e2e** (no Playwright driving the app) | No automated coverage of real user flows | 🟠 Medium |
| **Commit-message linting only on PR titles** | Intermediate commit history unconstrained (acceptable if squash-merging) | 🟡 Low |
| **Perf gate not in per-PR signal** (nightly/manual only) | Regressions found a day late, not on the PR | 🟡 Low |

> Repo nuance that shapes tooling choice: **there is no root `package.json`** — the monorepo root
> is polyglot (Go `apps/rowboat-api` + `tools/desktop-perf`, Next.js `apps/rowboat`/`rowboatx`,
> and the nested pnpm workspace `apps/x`). Git hooks install at the **git root**, but the JS
> toolchain lives under `apps/x`. This matters for the hook-tool decision (§5).

---

## 3. How the reference projects do it (condensed)

### VS Code — the gold standard (three-tier model)
- **Hooks (fast, local, staged-only):** legacy husky wires a `precommit` npm script → `build/hygiene.ts`,
  which reads **staged files only** (`git diff --cached`) and checks copyright header, tab
  indentation, formatting, and a unicode allowlist. **ESLint/typecheck are *not* in the hook** —
  they run in CI. Errors are phrased as machine-fixable ("Run Format Document to fix").
- **CI (medium):** `.github/workflows/pr.yml` runs `compile + hygiene + eslint + valid-layers-check`
  (architecture import-boundary check) in parallel, then a per-OS reusable test matrix.
- **Tests (layered, cheapest first):** unit (mocha, per-context runners: node / Electron-renderer /
  browser) → integration (`@vscode/test-electron` launching the built app against a test workspace)
  → **smoke e2e (Playwright on the packaged build, `--build <path>`)**, across Linux/macOS/Windows.
- **Perf (off the PR critical path):** named perf marks (`mark('code/...')`) measured between
  markers, `@vscode/vscode-perf` runs N times and reports the **median** + heap stats; a
  **`chat-perf.yml`** workflow fails on **>20% regression** vs a baseline build (manual/scheduled,
  not per-PR).

### Cross-cutting patterns from 8 OSS Electron apps (2025)
- **Pre-commit:** **husky 9 + lint-staged 16/17** is the dominant JS pattern (Joplin, Bitwarden,
  Element Desktop, Element Web) running **eslint + prettier on staged files**. The other half
  (Signal, Mattermost, Logseq, Standard Notes) use **no local hooks** and enforce in CI.
  **lefthook: 0/8. commitlint-wired-to-a-hook: 0/8.** Joplin deliberately **excludes `tsc` from
  pre-commit** ("too slow on the monorepo") — typecheck belongs in CI/pre-push.
- **e2e:** **Playwright is the winner (6/7 GUI-testing projects)**; for Electron the modern idiom is
  **`_electron.launch({ executablePath })`** driving the built binary (Signal, Element Desktop).
  **WebdriverIO/`wdio-electron-service`: 0/8. Spectron: 0/8** (Mattermost migrated off it). Unit
  runner: **jest dominates**; we use vitest (equivalent, fine).
- **Perf:** **only Signal has real benchmarks (1/8)** — a scheduled (every-12h) Playwright-driven
  startup/throughput suite with OpenTelemetry export. **7/8 have none.** → our existing gate is a
  genuine differentiator.

**Reference matrix**

| Project | Hooks | e2e framework | Perf tests |
|---|---|---|---|
| VS Code | husky `precommit`→hygiene (staged) | Playwright (packaged build) | marks + vscode-perf + 20% threshold gate |
| Signal Desktop | none (CI-enforced) | Playwright `_electron` | **yes** (scheduled benchmarks + OTel) |
| Element Desktop | husky + lint-staged | Playwright `_electron.launch` | none |
| Joplin | husky + lint-staged (no tsc) | `@playwright/test` | none |
| Bitwarden (desktop) | husky + lint-staged | jest only (no GUI e2e) | none |
| Mattermost desktop | none | `@playwright/test` (built app) | none |
| Logseq | none | Playwright (Java/Clojure) | none |
| Standard Notes | commitlint cfg unused | mocha-headless / AVA | none |
| **rowboat `apps/x` (us)** | **none → P0** | **boot-smoke only → P1** | **tiered Go gate (ahead)** |

---

## 4. Guiding principles

1. **Layer the gates, cheapest-fastest first** (VS Code's model): pre-commit (sub-second) →
   commit-msg (instant) → pre-push (seconds) → PR CI (minutes) → nightly (heavy).
2. **The pre-commit hook stays fast and staged-only.** Format + lint-fix on changed files. **No
   typecheck, no tests in the hook** (Joplin's lesson). Anything slower goes to pre-push or CI.
3. **Single source of truth.** Each check is one script callable from both the hook (staged scope)
   and CI (full scope), so they never drift.
4. **Don't reinvent perf.** Reuse `tools/desktop-perf`; add cheap signal per-PR and a threshold
   regression gate rather than a new system.
5. **Fail on a *relative* threshold for perf** (VS Code's 20%), not just absolute budgets, so noisy
   machines don't block and real regressions do.
6. **Make hooks bypassable in emergencies** (`--no-verify`) but enforced in CI, so CI is the real
   gate and the hook is just fast feedback.

---

## 5. Tooling decisions (with rationale)

| Decision | Choice | Why (evidence) |
|---|---|---|
| **Hook runner** | **lefthook** at the git root (primary) — or husky+lint-staged scoped to `apps/x` (alternative) | The root is **polyglot with no root `package.json`**. lefthook is a single language-agnostic binary that runs per-glob commands (TS *and* Go *and* Next) in parallel without a Node package at the root — a cleaner fit than husky here. *Caveat:* the JS-ecosystem standard is husky+lint-staged (4/8 OSS apps); if we'd rather keep hooks inside `apps/x` and stay 100% conventional, use that. **Recommendation: lefthook for the root**, because our root is not a JS package. |
| **Staged-file lint/format** | **eslint --fix + prettier --write** on staged TS/TSX; `gofmt`/`go vet` on staged Go | Matches the dominant OSS pattern (eslint+prettier on staged). |
| **Formatter** | **Prettier 3** + `.editorconfig` | We have none today; every husky-using OSS app pairs eslint with prettier. |
| **Commit messages** | Keep **PR-title lint** as the gate (we squash-merge → PR title *is* the commit). Add local `commit-msg` commitlint only if we want clean intermediate history. | commitlint-via-hook was 0/8; PR-title/CI enforcement is the norm. Low priority. |
| **Renderer typecheck** | Add `tsc -b` to PR CI (and optionally pre-push) | Currently ungated; Joplin keeps tsc out of pre-commit but it must run *somewhere*. |
| **e2e** | **Playwright `_electron.launch`** against the Forge-packaged build | 6/7 OSS GUI suites use Playwright; `_electron` is the modern Electron idiom (Signal, Element). Avoid Spectron (dead) and wdio (0/8). |
| **Unit tests** | Keep **vitest**, expand coverage | Equivalent to the jest majority; already wired. |
| **Perf** | Keep the **Go gate**; add per-PR perf-lite + threshold regression gate | We're ahead of the field; don't rebuild. |

---

## 6. The plan, by gate layer

### Layer 0 — Foundations
- [ ] Add **Prettier 3** config + `.prettierignore` and a root **`.editorconfig`** (tabs/spaces, EOL,
      final newline) covering `apps/x` (and ideally the Next apps).
- [ ] Add a single **`scripts/lint-staged-*`** (or `lint-staged.config.mjs` under `apps/x`) that is
      the *one* definition of "format + lint a set of files", callable by the hook and CI.

### Layer 1 — Pre-commit hook (fast, staged-only) — **P0**
- [ ] Install **lefthook** at the git root with a `lefthook.yml`:
  - `apps/x/**/*.{ts,tsx}` (staged) → `eslint --fix` + `prettier --write`
  - `apps/rowboat/**`, `apps/rowboatx/**` `*.{ts,tsx}` (staged) → prettier/eslint as configured there
  - `**/*.go` (staged) → `gofmt -w` + `go vet` (scoped to the changed module)
  - Keep total hook time **< ~2s on a typical change**; never run `tsc` or tests here.
- [ ] Document `git commit --no-verify` as the documented escape hatch.

### Layer 2 — commit-msg (optional) — **P3**
- [ ] *Only if we want constrained intermediate history:* add commitlint (`@commitlint/config-conventional`)
      with the **same types as `pr-title-lint.yml`** (feat/fix/perf/refactor/docs/chore/build/ci/test/revert),
      wired via lefthook `commit-msg`. Otherwise rely on PR-title lint + squash-merge.

### Layer 3 — pre-push (optional, opt-in) — **P2**
- [ ] lefthook `pre-push`: run **renderer `tsc -b`** (typecheck) + **`apps/x` `npm test`** (the
      vitest unit suite). Fast enough for push, too slow for commit (Joplin's split). Make it
      skippable for WIP branches.

### Layer 4 — PR CI (the real gate) — **P0/P1**
Augment `x-smoke-test.yml` (or split into `x-ci.yml`):
- [ ] **P0: add renderer typecheck** — `cd apps/x/apps/renderer && npx tsc -b` (closes the highest-risk gap).
- [ ] **P0: run unit tests** — `cd apps/x && npm test` (currently not in PR CI).
- [ ] **P1: replace the 5s boot smoke with a real Playwright-Electron smoke** — `_electron.launch`
      the packaged binary, assert: window opens, renderer reaches the empty/sign-in shell, a basic
      interaction works (e.g., focus composer, open settings). Keep it headless under xvfb on Linux;
      add macOS later.
- [ ] **P1: perf-lite job** — the cheap subset of the perf gate that needs **no kind/API stack**:
      `vite build` + assert `rendererAssetSizeMb` budget, and a backend-less **cold-launch-to-CDP**
      time check (reuse `tools/desktop-perf` size/CDP code paths via a `--no-backend` mode, or a thin
      script). Posts the numbers as a PR check.
- [ ] Keep lint + the existing package step; order **typecheck → lint → unit → build → smoke** so the
      cheapest failures surface first (VS Code ordering).

### Layer 5 — Nightly / weekly (heavy) — **P2**
- [ ] Keep `desktop-perf-nightly.yml` (full nightly, deep weekly) as-is.
- [ ] **Add a perf regression gate** (the VS Code `chat-perf.yml` pattern): compare the run against a
      committed/stored baseline and **fail on >X% regression** on key metrics
      (`startupInteractiveMs`, `peakRssMb`, `rendererAssetSizeMb`, IPC p95). `tools/desktop-perf`
      already computes comparable metrics + machine-local baselines — extend it to a CI baseline
      artifact so the threshold check runs in CI, not just locally.
- [ ] **Grow the Playwright-Electron suite into a nightly e2e matrix** (Linux + macOS) covering the
      core workflows the perf gate already drives (chat submit, workspace read/write/search,
      settings, model config) — turning perf "workflows" into asserted regression tests.

---

## 7. Phased rollout

| Phase | Goal | Items | Rough effort |
|---|---|---|---|
| **P0** (week 1) | Stop bad code merging; fast local feedback | Prettier + editorconfig (L0); lefthook pre-commit (L1); renderer typecheck + unit tests in PR CI (L4) | ~1–2 dev-days |
| **P1** (week 2–3) | Real automated regression signal | Playwright-Electron smoke replacing boot-smoke; perf-lite PR job (L4) | ~3–5 dev-days |
| **P2** (month 2) | Depth + heavy gates | pre-push typecheck/tests (L3); nightly e2e matrix; perf threshold regression gate (L5) | ~1–2 dev-weeks |
| **P3** (opportunistic) | Polish | commit-msg lint (L2); architecture import-boundary check (main/preload/renderer, à la VS Code `layersChecker`); macOS/Windows e2e | as capacity allows |

---

## 8. Concrete first changes (P0 checklist, file-level)

1. `lefthook.yml` (repo root) — pre-commit globs for `apps/x` TS (eslint --fix + prettier) and Go (gofmt + go vet).
2. `apps/x/.prettierrc` (or root) + `.prettierignore`; `.editorconfig` (repo root).
3. `apps/x/apps/renderer` — confirm `tsc -b` is the typecheck entry (it is: `build` = `tsc -b && vite build`); add a standalone `typecheck` script.
4. `.github/workflows/x-smoke-test.yml` — insert steps: `renderer typecheck`, `apps/x npm test`, before/after the package step.
5. Onboarding note in `apps/x/CLAUDE.md` / `README` — how hooks run, `--no-verify`, and `make perf-desktop`.

---

## 9. Non-goals / risks

- **Not** rebuilding the perf system — we're ahead; we extend it.
- **Not** putting the full perf gate (needs kind/API) on every PR — too slow/heavy; it stays
  nightly, with only perf-lite per-PR.
- **Risk:** hooks that are slow or flaky get bypassed and rot (the reason 4/8 OSS apps dropped them).
  Mitigation: keep pre-commit sub-2s and staged-only; push typecheck/tests to pre-push/CI.
- **Risk:** Playwright-Electron flakiness on CI. Mitigation: start with a tiny, deterministic smoke
  (launch + shell-ready + one interaction) under xvfb, expand only once green and stable.
- **Risk:** polyglot-root hook tooling. Mitigation: lefthook chosen specifically because the root has
  no `package.json`; if the team prefers JS-standard tooling, scope husky+lint-staged inside `apps/x`.

---

## 10. Sources

**VS Code:** `package.json`, `build/hygiene.ts`, `.github/workflows/pr.yml`, `pr-linux-test.yml`,
`chat-perf.yml`, `scripts/code-perf.js`, `microsoft/vscode-perf`, `timerService.ts (IStartupMetrics)`,
`scripts/test-integration.sh`, `test/smoke/README.md`; wiki "Perf Tools for VS Code Development".
**OSS survey:** Signal `benchmark.yml`/`commits.yml`/`package.json`; Element Desktop
`.husky/pre-commit`/`playwright.config.ts`/`element-desktop-test.ts`; Joplin `.husky/pre-commit`/
`lint-staged.config.js`; Bitwarden `.husky/pre-commit`/`lint-staged.config.mjs`; Mattermost `e2e/`;
Logseq `clj-e2e/`; Standard Notes `commitlint.config.js`/`pr.yml`. Playwright Electron API:
`playwright.dev/docs/api/class-electron`. Electron perf guidance:
`electronjs.org/docs/latest/tutorial/performance`.
