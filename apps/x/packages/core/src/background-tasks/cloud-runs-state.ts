import fs from "fs/promises";
import path from "path";
import type { BackgroundTaskOfflineRunsEventType } from "@x/shared/dist/background-task.js";
import { PrefixLogger } from "@x/shared/dist/prefix-logger.js";
import { WorkDir } from "../config/config.js";
import type { RemoteRun } from "./cloud-sync.js";

const log = new PrefixLogger("BgTask:OfflineReturn");

// RFC 006 offline-return state: which cloud runs the user has already been
// shown, persisted across app restarts so a long absence notifies once.
const STATE_FILE = path.join(WorkDir, "config", "cloud-runs-seen.json");
const MAX_NOTIFIED_IDS = 200;

export interface CloudRunsSeenState {
  version: 1;
  lastSeenCloudRunAt: string;
  lastOfflineNotificationAt?: string;
  lastNotifiedRunIds: string[];
}

export async function readCloudRunsSeenState(): Promise<CloudRunsSeenState | null> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.lastSeenCloudRunAt !== "string") return null;
    return {
      version: 1,
      lastSeenCloudRunAt: parsed.lastSeenCloudRunAt,
      ...(parsed.lastOfflineNotificationAt
        ? { lastOfflineNotificationAt: parsed.lastOfflineNotificationAt }
        : {}),
      lastNotifiedRunIds: Array.isArray(parsed.lastNotifiedRunIds)
        ? parsed.lastNotifiedRunIds.filter((id: unknown) => typeof id === "string")
        : [],
    };
  } catch {
    return null;
  }
}

export async function writeCloudRunsSeenState(state: CloudRunsSeenState): Promise<void> {
  try {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await fs.writeFile(
      STATE_FILE,
      JSON.stringify({
        ...state,
        lastNotifiedRunIds: state.lastNotifiedRunIds.slice(-MAX_NOTIFIED_IDS),
      }),
      "utf-8",
    );
  } catch (err) {
    // Advisory state; a write failure must not break the boot sequence.
    log.log(`seen-state write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function runTimestamp(run: RemoteRun): string {
  return run.completedAt ?? run.updatedAt ?? run.createdAt;
}

// checkOfflineReturn finds cloud runs that reached a terminal state while the
// app was closed, auto-pulls the newest successful artifact per task (gated
// by the artifact-sync sidecar so a local edit is never clobbered), advances
// the seen marker, and returns the notification payload (null when there is
// nothing new to show — including the very first run, which initializes the
// marker without dredging up history).
export async function checkOfflineReturn(): Promise<BackgroundTaskOfflineRunsEventType | null> {
  const prior = await readCloudRunsSeenState();
  const now = new Date().toISOString();
  if (!prior) {
    await writeCloudRunsSeenState({ version: 1, lastSeenCloudRunAt: now, lastNotifiedRunIds: [] });
    return null;
  }

  const { getArtifactSyncState, listAllCloudRuns, syncArtifactFromCloud } =
    await import("./cloud-sync.js");

  const { runs } = await listAllCloudRuns({
    since: prior.lastSeenCloudRunAt,
    executor: "api",
    limit: 200,
  });
  const notified = new Set(prior.lastNotifiedRunIds);
  const terminal = runs.filter(
    (run) =>
      (run.status === "succeeded" || run.status === "failed" || run.status === "stopped") &&
      !notified.has(run.runId),
  );

  // Advance the marker over everything we saw (terminal or not) so re-boots
  // don't re-scan the same window forever; in-flight runs are visible live in
  // the runs view anyway.
  let newestSeen = prior.lastSeenCloudRunAt;
  for (const run of runs) {
    const ts = runTimestamp(run);
    if (ts > newestSeen) newestSeen = ts;
  }

  if (terminal.length === 0) {
    await writeCloudRunsSeenState({ ...prior, lastSeenCloudRunAt: newestSeen });
    return null;
  }

  // Auto-pull the newest successful run's artifact per task, gated by the
  // sync sidecar (bounded: one artifact per task, newest only).
  const newestSuccessBySlug = new Map<string, RemoteRun>();
  for (const run of terminal) {
    if (run.status !== "succeeded") continue;
    const current = newestSuccessBySlug.get(run.slug);
    if (!current || runTimestamp(run) > runTimestamp(current)) {
      newestSuccessBySlug.set(run.slug, run);
    }
  }
  for (const [slug] of newestSuccessBySlug) {
    try {
      const sync = await getArtifactSyncState(slug);
      if (sync.state === "remote_newer" || sync.state === "not_pulled") {
        await syncArtifactFromCloud(slug);
      }
    } catch (err) {
      // One bad artifact must not block the notification or the marker write.
      log.log(
        `artifact auto-pull skipped for ${slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  await writeCloudRunsSeenState({
    version: 1,
    lastSeenCloudRunAt: newestSeen,
    lastOfflineNotificationAt: now,
    lastNotifiedRunIds: [...prior.lastNotifiedRunIds, ...terminal.map((run) => run.runId)],
  });

  log.log(`${terminal.length} cloud run(s) completed while the app was closed`);
  return {
    count: terminal.length,
    runs: terminal.slice(0, 20).map((run) => ({
      slug: run.slug,
      runId: run.runId,
      status: run.status,
      trigger: run.trigger,
      completedAt: run.completedAt ?? null,
      ...(run.summary ? { summary: run.summary } : {}),
    })),
  };
}
