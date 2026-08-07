import { PrefixLogger } from "@x/shared";
import { listTasks } from "./fileops.js";
import { runBackgroundTask } from "./runner.js";
import { processRemoteTriggers } from "./cloud-sync.js";
import { getAuthState } from "../auth/tokens.js";
import { backoffRemainingMs, dueTimedTrigger } from "../schedule/utils.js";

const log = new PrefixLogger("BgTask:Scheduler");
const POLL_INTERVAL_MS = 15_000; // 15 seconds — matches live-note scheduler

// Log auth-quiesce only on state transitions, not every 15s tick.
let lastLoggedAuthState: string | null = null;

function humanMs(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return `${m}m`;
}

export async function processScheduledTasks(): Promise<void> {
  const { items } = await listTasks({ limit: 10_000 });

  const scannedCount = items.length;
  let activeCount = 0;
  let pausedCount = 0;
  let firedCount = 0;
  let backoffCount = 0;
  let inFlightCount = 0;

  for (const task of items) {
    if (!task.active) {
      pausedCount++;
      continue;
    }
    // RFC 006: api-target timed triggers are cloud-owned — the API
    // scheduler loop (RFC 001) and Temporal Schedules (RFC 005) fire them
    // even while this app is closed. Evaluating them here from local
    // anchors double-fired occurrences whenever the desktop was open.
    // Manual triggers and cloud-requested desktop runs
    // (processRemoteTriggers below) are unaffected.
    if ((task.executionTarget ?? "desktop") === "api") {
      continue;
    }
    activeCount++;

    // In-flight skip — `lastAttemptAt` set more recently than `lastRunAt`
    // means the latest attempt never completed. The in-memory concurrency
    // guard in the runner is the fast path; this is the disk-persistent
    // backstop covering crashes mid-run.
    const attemptAt = task.lastAttemptAt;
    const completedAt = task.lastRunAt;
    if (attemptAt && (!completedAt || attemptAt > completedAt)) {
      // …but only treat as in-flight if the attempt is still within the
      // backoff window. After backoff expires the next iteration is free
      // to retry (matches the runner's fail/crash recovery story).
      if (backoffRemainingMs(attemptAt) > 0) {
        inFlightCount++;
        continue;
      }
    }

    // Cycle anchor: only successful runs advance the cycle. Failures
    // leave the cycle unfired so the next natural occurrence retries
    // (gated by backoff).
    const source = dueTimedTrigger(task.triggers, completedAt ?? null);
    if (!source) continue;

    const backoffMs = backoffRemainingMs(attemptAt ?? null);
    if (backoffMs > 0) {
      backoffCount++;
      log.log(`${task.slug} — skip (matched ${source}, backoff ${humanMs(backoffMs)} remaining)`);
      continue;
    }

    firedCount++;
    log.log(`${task.slug} — firing (matched ${source})`);
    runBackgroundTask(task.slug, source).catch((err) => {
      log.log(`${task.slug} — fire error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  if (activeCount > 0 || firedCount > 0 || backoffCount > 0 || inFlightCount > 0) {
    log.log(
      `tick — scanned ${scannedCount} tasks, ${activeCount} active` +
        (pausedCount > 0 ? `, ${pausedCount} paused` : "") +
        (inFlightCount > 0 ? `, ${inFlightCount} in-flight` : "") +
        (firedCount > 0 ? `, fired ${firedCount}` : "") +
        (backoffCount > 0 ? `, backoff ${backoffCount}` : ""),
    );
  }

  // Skip cloud work entirely while the session can't produce a bearer —
  // hitting the API anyway is what used to hammer the broker's rate limit.
  const auth = getAuthState();
  if (auth.state === "reconnect_required" || auth.state === "backoff") {
    if (lastLoggedAuthState !== auth.state) {
      lastLoggedAuthState = auth.state;
      log.log(
        auth.state === "reconnect_required"
          ? "auth requires reconnect — pausing remote trigger sync until sign-in"
          : `auth refresh backing off — pausing remote trigger sync until ${new Date(auth.retryAt ?? Date.now()).toLocaleTimeString()}`,
      );
    }
    return;
  }
  if (lastLoggedAuthState !== null) {
    lastLoggedAuthState = null;
    log.log("auth available again — resuming remote trigger sync");
  }

  try {
    await processRemoteTriggers();
  } catch (err) {
    log.log(`remote trigger sync error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function init(): Promise<void> {
  log.log(`starting, polling every ${POLL_INTERVAL_MS / 1000}s`);

  // Guarded like every later tick — a bare first run that threw killed the
  // service until app restart (init() is a floating promise).
  try {
    await processScheduledTasks();
  } catch (err) {
    log.log(`initial run failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    try {
      await processScheduledTasks();
    } catch (err) {
      log.log(`tick error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
