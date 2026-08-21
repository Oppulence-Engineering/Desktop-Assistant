# Electron Architecture Gauntlet

The desktop application enforces this dependency and trust flow:

```text
renderer -> typed preload bridge -> validated IPC -> main orchestration
         -> Electron-free core domains -> repositories/filesystem/adapters
```

Run the complete local gate with:

```bash
pnpm verify
```

CI runs `pnpm verify:ci`, which additionally requires Semgrep, Gitleaks,
OSV-Scanner, and Conftest to be installed. Missing external tools are reported as
local warnings but are failures in CI.

## Enforced rules

| ID   | Invariant                                                                  | Primary enforcement                        |
| ---- | -------------------------------------------------------------------------- | ------------------------------------------ |
| X001 | `packages/core` cannot import Electron or application packages             | ESLint, dependency-cruiser, ast-grep       |
| X002 | No `@x/core/dist/**`, `@x/shared/dist/**`, or source escape imports        | ESLint, dependency-cruiser, ast-grep       |
| X003 | IPC channels come from the shared contract registry                        | ESLint                                     |
| X004 | IPC invoke requests have shared Zod schemas                                | shared registry, ESLint                    |
| X005 | IPC invoke responses are runtime validated                                 | shared registry, handler wrapper           |
| X006 | Main-to-renderer events use shared runtime schemas                         | `emitRendererEvent`                        |
| X007 | Renderer-to-main IPC validates its sender                                  | central IPC registration wrapper           |
| X008 | Preload never exposes raw `ipcRenderer`                                    | ESLint, Semgrep                            |
| X009 | New direct persistence writes are forbidden outside approved safety layers | ESLint baseline, Semgrep                   |
| X010 | New persisted JSON reads require runtime validation                        | ESLint baseline, `readValidatedJson`       |
| X011 | Destructive filesystem operations require path-containment review          | Semgrep                                    |
| X012 | New `container.resolve()` calls stay at composition boundaries             | ESLint baseline                            |
| X013 | Application DOM events use the typed renderer event map                    | ESLint, ast-grep                           |
| X014 | New long-lived services require explicit teardown ownership                | ESLint baseline, lifecycle registry        |
| X015 | Dangerous Electron `webPreferences` are forbidden                          | ESLint, Semgrep                            |
| X016 | External URLs pass through the trusted URL policy                          | ESLint, ast-grep, Semgrep                  |
| X017 | Scheduler jobs must retain a concurrency guard                             | architecture review; planned semantic rule |
| X018 | Background retries must retain bounded backoff                             | architecture review; planned semantic rule |
| X019 | Durable processing requires an idempotency identity                        | domain tests; planned semantic rule        |
| X020 | Generated outputs are changed through their generator                      | package/export checks and review           |

## Ratchets

The repository contains legacy debt that cannot safely be rewritten as one mechanical
change. Ratchets record exact existing findings and reject new ones:

- `config/baselines/architecture.json`: direct writes, raw reads, service-location, and pollers.
- `config/baselines/dependency-cruiser-known-violations.json`: existing dependency cycles.
- `config/baselines/knip.json`: existing unused files and symbols.
- `config/baselines/prettier.json`: existing formatting debt.

Only update a baseline after reviewing every added fingerprint. Removing a fingerprint
is encouraged; reintroducing it fails the gate.

## Process-boundary helpers

- `apps/main/src/ipc-security.ts` validates the calling `webContents` before request parsing.
- `apps/main/src/renderer-events.ts` validates outbound event payloads before sending.
- `apps/renderer/src/lib/renderer-events.ts` provides typed DOM event dispatch/listening.
- `apps/main/src/external-url-policy.ts` keeps URL trust decisions testable without Electron.
- `apps/main/src/safe-json-file.js` combines JSON parsing with Zod validation.
- `packages/core/src/services/lifecycle.ts` owns startup, rollback, cancellation, and reverse-order teardown.

## Electron package policy

Forge applies the fuse policy in `apps/main/fuse-policy.cjs`. The packaged application
disables Run-as-Node, Node options, and CLI inspection while enabling cookie encryption.
ASAR-only loading and embedded ASAR integrity remain disabled because the current native
ONNX runtime is staged outside the ASAR; `pnpm fuses:verify <app-path>` checks the explicit
policy rather than assuming defaults. The newer Wasm trap-handler fuse is omitted because
Electron 39's fuse wire predates it; strict mode still requires every fuse supported by the
packaged runtime to have an explicit value.

## Package surfaces

`@x/core` and `@x/shared` expose root and wildcard public exports. `publint` and
Are The Types Wrong verify those surfaces, while lint and graph rules reject `dist/` and
`src/` escape hatches.
