# Rowboat Desktop Performance Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Rowboat desktop startup delay, renderer jank, and disk/IPC amplification in the Electron app under `apps/x`.

**Architecture:** Keep the app's current Electron + Vite + React + local `~/.rowboat` workspace design. Move non-critical startup work out of the first-window path, keep expensive filesystem scans bounded or coalesced, and cap UI-thread work for large local datasets.

**Tech Stack:** Electron main/preload, React 19 renderer, TypeScript, Zod IPC schemas, Node filesystem APIs, `node:test` regression tests against compiled desktop packages.

---

## Audit Findings

1. Main startup blocks on environment and global CLI work before the window is usable.
   `apps/x/apps/main/src/main.ts` synchronously spawns the login shell in `initializeExecutionEnvironment()`, then `app.whenReady()` checks `agent-slack --version` and may run `npm install -g agent-slack` before `createWindow()`. On a missing CLI or slow shell profile this can add seconds or a full minute to cold launch.

2. Every background service starts immediately after the window is created.
   Gmail, Calendar, Fireflies, Granola, graph building, email labeling, note tagging, inline tasks, agent runners, schedulers, event processors, Chrome sync, and local sites all start in one block. Some initializers perform disk scans or immediate first ticks, competing with first render and user input.

3. The renderer loads every chat-history page on mount and again on run completion.
   `loadRuns()` loops through every `runs:list` page. Each page currently calls `FSRunsRepo.list()`, which re-reads and re-sorts the full runs directory before reading a page of metadata. With many run logs this becomes O(pages * files) work on every mount/run end.

4. Workspace tree refreshes are full recursive scans per filesystem event.
   `workspace:didChange` calls `loadDirectory().then(setTree)` immediately. `loadDirectory()` recursively reads `knowledge` with stats and reads `bases`; bursty sync/import/autosave events can launch overlapping full-tree scans and React tree rebuilds.

5. Recursive workspace listing serializes file stats.
   `packages/core/src/workspace/workspace.ts` awaits `fs.lstat` one entry at a time when `includeStats` is enabled. The desktop tree and bases view request stats, so large workspaces pay avoidable serial IO latency.

6. Graph rendering can monopolize the renderer thread.
   `GraphView` performs a 240-step force simulation with all-pairs repulsion, O(nodes^2 * 240), and then keeps an ambient animation running forever. A few hundred notes can become visible UI jank; a large vault can freeze the graph view.

7. Chat streaming updates React state for every text delta.
   `handleRunEvent()` appends to state on each `llm-stream-event` text delta. Fast streams cause excessive renders of the chat pane and related memoized structures.

8. Search fans out too much work after `grep`.
   `search.ts` runs `grep -ril` and then calls `getFirstMatchingLine()` for every matching file before slicing to the UI limit. Broad queries in large knowledge/chat folders can open many unnecessary file streams.

9. Verbose run-event logging adds overhead during active streams.
   The renderer logs the full event object for every run event, including streaming events. Console logging large payloads during token streaming adds avoidable renderer overhead.

10. Analytics identity performs sequential workspace IPC on mount.
    `useAnalyticsIdentity()` walks top-level workspace directories via multiple sequential `workspace:readdir` IPC calls just to set `total_notes`. This is not needed for first-use interaction and should be bounded or deferred.

## Execution Tasks

### Task 1: Remove Blocking Startup Work

**Files:**
- Modify: `apps/x/apps/main/src/main.ts`
- Create: `apps/x/apps/main/src/agent-slack.ts`
- Modify: `apps/x/apps/main/src/ipc.ts`

- [ ] Convert shell environment hydration from `execFileSync` to a memoized async function.
- [ ] Schedule environment hydration after the first window is created instead of before `app.whenReady()` creates UI.
- [ ] Delete the startup `agent-slack --version` / `npm install -g agent-slack` block from `main.ts`.
- [ ] Add `ensureAgentSlackAvailable()` and call it only inside `slack:listWorkspaces`.
- [ ] Preserve existing Slack behavior by still installing on demand, with one shared in-flight install promise and the existing timeouts.

### Task 2: Bound Run History Loading

**Files:**
- Modify: `apps/x/packages/shared/src/runs.ts`
- Modify: `apps/x/packages/shared/src/ipc.ts`
- Modify: `apps/x/packages/core/src/runs/repo.ts`
- Modify: `apps/x/packages/core/src/runs/runs.ts`
- Modify: `apps/x/apps/main/src/ipc.ts`
- Modify: `apps/x/apps/renderer/src/App.tsx`
- Test: `apps/x/packages/core/test/runs-list.test.mjs`

- [ ] Add a `ListRunsOptions` schema with `cursor`, `limit`, and `agentId`.
- [ ] Make `FSRunsRepo.list()` read until it has `limit` matching rows, using the last examined filename as `nextCursor`.
- [ ] Keep default page size at 20 and cap explicit limits at 100.
- [ ] Change the renderer to request only the latest 100 Copilot runs instead of draining every page.
- [ ] Add `node:test` coverage that proves `agentId` filtering and `nextCursor` pagination do not skip rows.

### Task 3: Coalesce Workspace Tree Refreshes

**Files:**
- Modify: `apps/x/apps/renderer/src/App.tsx`
- Modify: `apps/x/packages/core/src/workspace/workspace.ts`

- [ ] Add a small renderer-side scheduler that allows one immediate tree refresh, coalesces follow-up filesystem bursts, and prevents overlapping `loadDirectory()` calls.
- [ ] Replace the direct `loadDirectory().then(setTree)` inside `workspace:didChange`.
- [ ] Keep current-file reload logic immediate so external edits still update the editor promptly.
- [ ] Parallelize per-directory stat work in `workspace.readdir()` while preserving the final sorted output.

### Task 4: Reduce Renderer Hot-Loop Work

**Files:**
- Modify: `apps/x/apps/renderer/src/App.tsx`
- Modify: `apps/x/apps/renderer/src/components/graph-view.tsx`

- [ ] Buffer active run text deltas and flush them to React state at animation-frame cadence.
- [ ] Use the buffered text when the final assistant message arrives so the last delta is not lost.
- [ ] Gate full run-event console logging behind `import.meta.env.DEV` and skip raw stream payload spam.
- [ ] Precompute graph node IDs once per graph input.
- [ ] Disable the all-pairs force simulation above a safe node threshold and lay out large graphs deterministically by group.
- [ ] Disable ambient graph animation for large graphs.

### Task 5: Bound Search Fan-Out

**Files:**
- Modify: `apps/x/packages/core/src/search/search.ts`
- Test: `apps/x/packages/core/test/search-limit.test.mjs`

- [ ] Pass the requested result limit down to `grepFiles()`.
- [ ] Slice matched file paths before opening preview streams.
- [ ] Add a test proving broad content matches return only the requested number of results.

### Task 6: Defer Non-Critical Analytics Work

**Files:**
- Modify: `apps/x/apps/renderer/src/hooks/useAnalyticsIdentity.ts`

- [ ] Keep sign-in/provider identity updates on mount.
- [ ] Move `total_notes` calculation to idle time with a hard cap on directory reads.
- [ ] Make the note count best-effort and non-blocking.

### Task 7: Verify and Publish

**Files:**
- Modify: `apps/x/package.json`

- [ ] Add a desktop `test` script that builds the needed packages and runs `node --test`.
- [ ] Run `pnpm --dir apps/x install` only if lockfile changes are required.
- [ ] Run `pnpm --dir apps/x test`.
- [ ] Run `pnpm --dir apps/x lint`.
- [ ] Run `pnpm --dir apps/x --filter @x/renderer build`.
- [ ] Review `git diff` and stage only intended desktop performance files plus this plan.
- [ ] Commit, push the current branch, and open a draft PR.
