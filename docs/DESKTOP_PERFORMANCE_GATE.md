# Desktop Performance Gate

`make perf-desktop` is the commit-level desktop performance gate. It packages the Electron app, starts it against the local kind Rowboat API/devstack, drives representative desktop workflows, records process-tree resource usage, captures a renderer CPU profile, and fails on resource or latency budgets.

Run the API stack first:

```bash
make api-up
make perf-desktop
```

Useful variants:

```bash
make perf-desktop-full       # include the API/Temporal background-task workflow
make perf-desktop-deep       # full gate plus deeper scale and memory-growth loops
make perf-desktop-quick      # reuse an existing package output for faster local loops
make perf-desktop-baseline   # update this machine's local comparison baseline
```

## What It Measures

The harness lives in `tools/desktop-perf` and uses:

- `gopsutil` to sample the full launched process tree once per second: total RSS, CPU percent, process count, thread count, and open file count when the OS supports it.
- Electron remote debugging/CDP to capture `renderer-workflow.cpuprofile` and renderer metrics such as JS heap usage and DOM counters.
- `agent-browser` to drive the actual desktop UI and preload IPC surface.

The default workflow covers:

- production packaging through Electron Forge;
- package and renderer asset size budgets;
- cold launch to CDP, navigation, paint, signed-in shell, and usable chat input using an isolated `ROWBOAT_WORKDIR`;
- model gateway visibility through the local Rowboat API;
- workspace writes, recursive tree reads, search, run-history listing, and model listing through `window.ipc`, including p50/p95/max IPC timing summaries;
- chat submission through the mock LLM gateway;
- renderer health metrics for script, task, layout, style recalculation, DOM node count, event listener count, resource count, JS heap, and long tasks;
- idle sampling after the workflow to catch background CPU burn.

`make perf-desktop-full` switches `ROWBOAT_DESKTOP_PERF_TIER=full`, seeds a larger 1,000-note workspace, enables the API-target background task create/run/status/events/artifact pull through the desktop IPC path, runs a short memory-growth loop, and measures warm relaunch against the same workdir. Keep that path for release, nightly, or backend-worker-sensitive changes; it depends on local Temporal health and is intentionally not the default every-change desktop gate.

`make perf-desktop-deep` switches `ROWBOAT_DESKTOP_PERF_TIER=deep`, seeds a 5,000-note workspace, and runs a longer memory-growth loop. Use it for dedicated perf machines or changes likely to affect workspace scale, renderer memory, startup, or bundling.

## Nightly CI

`.github/workflows/desktop-perf-nightly.yml` runs the full tier every night and the deep tier weekly, with manual `workflow_dispatch` support for either tier. The workflow provisions the local kind stack, runs the desktop perf gate under `xvfb`, uploads `.rowboat-kind/desktop-perf` plus Kubernetes diagnostics, and tears the kind cluster down in an `always()` step.

Required repository secret:

- `INFISICAL_TOKEN`: Infisical service or machine token that can export the dev/kind secrets referenced by `.infisical.json`.

## Budgets And Baselines

Absolute budgets are versioned in `tools/desktop-perf/budget.json`. The gate validates them strictly: active budgeted metrics must be present, finite, non-negative, and under their configured limit. The cloud workflow budget is only required for full/deep tiers; warm-launch, scale, and memory-growth budgets are only required outside the commit tier; open-file count is only required when the OS reports that sampling is supported.

Relative regression checks use a local, ignored baseline under `.rowboat-kind/desktop-perf/`:

```bash
make perf-desktop-baseline
make perf-desktop
```

The baseline check fails when a comparable metric regresses by more than the configured percentage and absolute noise floor. Keep one baseline per machine/OS/arch; do not commit generated baseline files.

## Artifacts

Each run writes an ignored artifact directory under `.rowboat-kind/desktop-perf/<timestamp>-<commit>/` and updates `.rowboat-kind/desktop-perf/latest`.

Key files:

- `report.json` summary, budgets, warnings, failures, comparable metrics, and workflow results.
- `resource-samples.csv` and `resource-samples.json` per-second process-tree samples.
- `renderer-workflow.cpuprofile` loadable in Chrome/Electron/VS Code profile viewers.
- `desktop.log`, `package.log`, `desktop-result.png`, and `desktop-result.txt`.

## Environment Controls

- `ROWBOAT_DESKTOP_PERF_MODE=package|dev` defaults to `package`.
- `ROWBOAT_DESKTOP_PERF_TIER=commit|full|deep` defaults to `commit`.
- `ROWBOAT_DESKTOP_PERF_INCLUDE_CLOUD=1` includes the cloud background-task workflow.
- `ROWBOAT_DESKTOP_PERF_SKIP_PACKAGE=1` reuses the existing packaged output.
- `ROWBOAT_DESKTOP_PERF_UPDATE_BASELINE=1` writes the local baseline.
- `ROWBOAT_DESKTOP_PERF_ARTIFACT_DIR=...` overrides the run output directory.
- `ROWBOAT_DESKTOP_PERF_AGENT_SESSION=...` overrides the isolated `agent-browser` session name.
- `ROWBOAT_DESKTOP_PERF_IDLE_SECONDS=10` controls idle sampling duration.
- `ROWBOAT_DESKTOP_PERF_SEED_NOTES=...` overrides tier-based seed corpus size.
- `ROWBOAT_DESKTOP_PERF_MEMORY_REPEATS=...` overrides tier-based memory-loop repeats.
- `ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT=9333` overrides CDP port; the perf gate defaults to `9333` to avoid colliding with the normal desktop smoke/debug port.

## Design Notes

The gate follows the same shape used by mature Electron projects: test the built product, drive real E2E workflows, inspect the multi-process tree, and keep CPU profiles as first-class artifacts. Electron's own performance guidance stresses measuring memory, CPU, disk resources, responsiveness, and profiling code paths. VS Code exposes startup timers, process status, renderer profiles, and built-product startup profiles for the same reason. Mattermost's desktop contributor docs also separate unit/E2E tests, debugging, and packaging as normal desktop development gates.

Primary references:

- Electron performance guidance: https://www.electronjs.org/docs/latest/tutorial/performance
- VS Code performance issue workflow: https://github.com/microsoft/vscode/wiki/Performance-Issues
- VS Code development performance tools: https://github.com/microsoft/vscode/wiki/%5BDEV%5D-Perf-Tools-for-VS-Code-Development
- Mattermost desktop testing docs: https://developers.mattermost.com/contribute/more-info/desktop/testing/
