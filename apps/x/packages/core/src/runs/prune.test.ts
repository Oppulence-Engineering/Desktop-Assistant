import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";

const TEST_WORKDIR = vi.hoisted(() => "/tmp/rowboat-runs-prune-test");
vi.mock("../config/config.js", () => ({ WorkDir: TEST_WORKDIR }));

import { pruneRunLogs } from "./repo.js";

/**
 * Nothing pruned run logs. `delete` exists but is only reachable from the IPC a
 * person clicks, so the directory grew for the life of the install — every
 * background batch writes one, and email labeling alone writes ~90 per sweep.
 * The evidence was on disk: 22,830 files and 2.4GB accumulated in an earlier
 * era of the same directory.
 */

const RUNS = path.join(TEST_WORKDIR, "runs");
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

async function run(name: string, ageDays: number): Promise<string> {
  const p = path.join(RUNS, `${name}.jsonl`);
  await fs.writeFile(p, "{}\n");
  const t = (NOW - ageDays * DAY) / 1000;
  await fs.utimes(p, t, t);
  return p;
}

async function makeRuns(count: number, ageDays: number, prefix: string): Promise<void> {
  for (let i = 0; i < count; i++) await run(`${prefix}-${i}`, ageDays);
}

beforeEach(async () => {
  await fs.rm(TEST_WORKDIR, { recursive: true, force: true });
  await fs.mkdir(RUNS, { recursive: true });
});

afterEach(async () => {
  await fs.rm(TEST_WORKDIR, { recursive: true, force: true }).catch(() => {});
});

describe("pruneRunLogs", () => {
  // A light user keeps everything, however old — history they can still open.
  it("keeps everything when there are fewer runs than the floor", async () => {
    await makeRuns(50, 400, "ancient");
    expect(await pruneRunLogs(NOW)).toBe(0);
    expect(await fs.readdir(RUNS)).toHaveLength(50);
  });

  it("removes old runs beyond the floor", async () => {
    await makeRuns(500, 1, "recent");
    await makeRuns(200, 90, "old");

    expect(await pruneRunLogs(NOW)).toBe(200);
    expect(await fs.readdir(RUNS)).toHaveLength(500);
  });

  // Age and floor together: a machine offline for a month must not come back
  // to an empty history.
  it("keeps recent runs even far past the floor", async () => {
    await makeRuns(900, 2, "recent");
    expect(await pruneRunLogs(NOW)).toBe(0);
    expect(await fs.readdir(RUNS)).toHaveLength(900);
  });

  it("keeps the newest when deciding what falls past the floor", async () => {
    await makeRuns(500, 100, "oldish");
    const newest = await run("newest", 0);

    await pruneRunLogs(NOW);

    // The newest survives: it is inside the floor, which is ordered by mtime.
    await expect(fs.access(newest)).resolves.toBeUndefined();
  });

  it("ignores files that are not run logs", async () => {
    await makeRuns(600, 90, "old");
    await fs.writeFile(path.join(RUNS, "notes.txt"), "keep");

    await pruneRunLogs(NOW);

    expect(await fs.readFile(path.join(RUNS, "notes.txt"), "utf8")).toBe("keep");
  });

  it("returns zero when the directory does not exist", async () => {
    await fs.rm(RUNS, { recursive: true, force: true });
    expect(await pruneRunLogs(NOW)).toBe(0);
  });
});
