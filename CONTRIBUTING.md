# Contributing

Thanks for your interest in contributing to Rowboat (Oppulence Engineering fork). This document covers what you need to know to land changes successfully.

## Repository layout

This is a monorepo. The most important paths:

- `apps/x/` — the Electron desktop application maintained by Oppulence Engineering. This is the path that drives releases.
- `.github/workflows/` — CI/CD pipelines, including the release pipeline.
- `.release-please-config.json` and `.release-please-manifest.json` — configuration for release-please, which is scoped to `apps/x/`.

## Conventional commits (required)

This repository uses [release-please](https://github.com/googleapis/release-please) to automate versioning and release notes. Release-please parses commit messages that follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

**Pull requests are merged with squash-merge, and the PR title becomes the commit message.** That means your PR title must follow the conventional commits format, or release-please will not pick up your change.

Examples that work:

- `feat(x): add settings panel for OpenAI API key`
- `fix(x): prevent crash when chat history is empty`
- `chore(deps): bump electron to 32.x`
- `docs: update README install steps`
- `ci: cache pnpm store across runs`

Version bumps follow these rules:

- `fix:` → patch bump (0.1.2 → 0.1.3)
- `feat:` → minor bump (0.1.2 → 0.2.0)
- `feat!:` or a `BREAKING CHANGE:` footer → major bump (0.1.2 → 1.0.0)
- `chore:`, `docs:`, `ci:`, `refactor:`, `test:`, `style:`, `perf:` → no version bump, but still appear in the changelog under their category.

## Path scope matters

Release-please only counts commits that touch files under `apps/x/`. A PR that changes only `.github/` or root-level files will **not** trigger a release, even if its title is `feat: ...`.

If you want to force a release without an app-level code change, add a `Release-As: X.Y.Z` footer to the commit body and include at least one file change under `apps/x/` (a comment update is enough).

## Release flow (what happens after your PR merges)

1. You merge a PR into `main` with a conventional-commits-formatted title.
2. The `Release` workflow runs. release-please opens (or updates) a `chore(main): release X.Y.Z` PR that bumps the version and updates the per-app changelog.
3. When you merge that release PR, release-please tags the commit (e.g. `v0.1.3`) and creates a GitHub Release.
4. The same workflow then runs the macOS, Linux, and Windows build jobs, which check out the new tag, build the Electron app, sign (macOS), and publish installers as assets on the GitHub Release.

See `.github/workflows/release.yml` for the source of truth.

## Local development

The Electron desktop app lives in `apps/x/`. From that directory:

```bash
pnpm install
pnpm dev
```

## Quality gates (hooks, tests, performance)

This repo runs layered checks, cheapest first. The full design and rationale is
in [`docs/ENGINEERING_QUALITY_GATES_PLAN.md`](./docs/ENGINEERING_QUALITY_GATES_PLAN.md).

### Git hooks (one-time setup)

Hooks are managed by [lefthook](https://lefthook.dev) and pinned in the **root**
tooling package. Install them once, from the repo root:

```bash
pnpm install --ignore-workspace   # installs lefthook + prettier + commitlint and runs `lefthook install`
# or: pnpm hooks:install
```

What runs, and when:

| Stage | Runs | Speed |
|---|---|---|
| **pre-commit** | Prettier + ESLint `--fix` on staged TS/JS; `gofmt` + `go vet` on staged Go | sub-second, staged-only |
| **commit-msg** | commitlint (Conventional Commits) | instant |
| **pre-push** | renderer `tsc -b` typecheck + `apps/x` unit tests | seconds |

Bypass in a pinch: `git commit --no-verify`, or `LEFTHOOK=0 git push`. CI is the
authoritative gate — hooks are just fast local feedback. Run the pre-commit
checks across the whole tree with `pnpm hooks:run`.

> Note: the pre-commit hook formats and lints **staged files only**, so Prettier
> is adopted gradually — a file is reformatted the first time you touch it, not
> all at once.

### CI gates

- **`x CI`** (`.github/workflows/x-smoke-test.yml`, on PRs touching `apps/x/`):
  renderer typecheck → lint → unit tests → package → **Playwright-Electron smoke**
  (drives the packaged build via `_electron.launch`).
- **`x perf-lite`** (`x-perf-lite.yml`): renderer bundle-size budget (backend-less).
- **`x e2e nightly`** (`x-e2e-nightly.yml`): the Playwright smoke on Linux **and** macOS.
- **`Desktop Performance Nightly`** (`desktop-perf-nightly.yml`): the full Go perf
  gate against a kind/API stack, with a rolling relative-regression baseline.

### Performance gate (local)

```bash
make api-up          # bring up the local kind Rowboat API stack
make perf-desktop    # package, drive, profile, and budget-check the desktop app
```

See [`docs/DESKTOP_PERFORMANCE_GATE.md`](./docs/DESKTOP_PERFORMANCE_GATE.md) for tiers and budgets.

## Reporting bugs and requesting features

- **Bugs:** open an issue with reproduction steps, your platform, and the app version (visible in About or `apps/x/apps/main/package.json`).
- **Features:** open an issue describing the use case before opening a PR for a non-trivial change, so we can agree on scope first.
- **Security vulnerabilities:** do **not** open a public issue. See [`SECURITY.md`](./SECURITY.md).

## Pull request checklist

Before requesting review:

- PR title follows Conventional Commits (it will become the squash-merge commit message).
- If you changed app behavior, you tested the change locally on at least one platform.
- If you added dependencies, you committed the updated `pnpm-lock.yaml`.
- Documentation is updated where relevant.
- No secrets, tokens, or personal data in commits or PR description.

## Code of conduct

Be kind. Assume good faith. Disagree on the substance, not the person. Maintainers reserve the right to close discussions and PRs that violate this.

## Upstream

This project is a fork of [rowboatlabs/rowboat](https://github.com/rowboatlabs/rowboat). If your contribution would also be useful upstream, consider opening a parallel PR there; the licensing is permissive and we are happy to coordinate.
