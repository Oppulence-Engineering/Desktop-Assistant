# Desktop Quality Gates

This repo's desktop checks are modeled after quality gates used by high-star Electron projects sampled from GitHub, including:

- [microsoft/vscode](https://github.com/microsoft/vscode): compile checks, ESLint, smoke tests, cyclic dependency checks, API proposal checks, and perf workflows.
- [electron/electron](https://github.com/electron/electron): lint/build/test pipelines, patch/audit checks, Scorecards, and PR template checks.
- [toeverything/AFFiNE](https://github.com/toeverything/AFFiNE): lint, prettier, oxlint, typecheck, unit tests, build tests, and desktop release workflows.
- [laurent22/joplin](https://github.com/laurent22/joplin): lint, generated-file checks, package JSON lint, spellcheck, circular dependency checks, and UI tests.
- [bitwarden/clients](https://github.com/bitwarden/clients): lint, type tests, locale tests, dependency ownership checks, scans, and target-specific desktop builds.
- [signalapp/Signal-Desktop](https://github.com/signalapp/Signal-Desktop): node/electron tests, type checks, oxlint, dependency lint, Storybook tests, release tests, and benchmarks.
- [mattermost/desktop](https://github.com/mattermost/desktop): type checks, unit tests, E2E, compatibility matrix, CodeQL, Scorecards, SBOM/Snyk, nightly builds, and package matrix checks.

## Rowboat Gates

- `Desktop Quality Gates`: PR workflow for `apps/x/**` that runs lint, core tests, Electron hardening checks, and TypeScript/build checks.
- `x Smoke Test`: PR workflow that packages the Linux Electron app and boots it under `xvfb`.
- `Desktop Performance Nightly`: scheduled full/deep kind-backed perf gate with artifacts and Kubernetes diagnostics.
- `Dependency Review`: PR gate that blocks newly introduced high-severity vulnerable dependencies.
- `CodeQL`: PR and weekly static analysis for desktop TypeScript and the Go desktop-perf harness.
- `Release`: platform package/release workflows for macOS, Linux, and Windows distributables.

## Electron-Specific Static Security Checks

`npm run security:electron` scans Electron main-process sources and fails if a `BrowserWindow` or `WebContentsView` omits explicit hardened `webPreferences`:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`

It also blocks known-dangerous web preferences such as `webSecurity: false`, `allowRunningInsecureContent: true`, and `enableRemoteModule: true`.
