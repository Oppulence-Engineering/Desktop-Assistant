import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

const TEST_WORKDIR = vi.hoisted(() => "/tmp/rowboat-bgtasks-traversal-test");
vi.mock("../config/config.js", () => ({ WorkDir: TEST_WORKDIR }));
// Creating/patching a task fires a best-effort cloud sync; keep the tests local.
vi.mock("./cloud-sync.js", () => ({
  syncTaskToCloudBestEffort: async () => {},
  deleteTaskFromCloudBestEffort: async () => {},
}));

import {
  createTask,
  deleteTask,
  fetchTask,
  listTasks,
  readRunIds,
  writeArtifactSync,
} from "./fileops.js";

/**
 * The worst of the traversals: `deleteTask` ends in
 * `fs.rm(taskDir(slug), { recursive: true, force: true })`, and the slug
 * arrives as a bare `z.string()` from the `bg-task:*` IPC — so ".." recursively
 * deleted the workspace and "" deleted the whole bg-tasks root, both silently,
 * because `force: true` suppresses the error.
 *
 * Slugs also reach these helpers from LLM builtin tools and from cloud artifact
 * responses, neither of which passes through a wire schema — which is why the
 * guard lives in taskDir rather than at the handler.
 */

const BG_TASKS = path.join(TEST_WORKDIR, "bg-tasks");

beforeEach(() => {
  fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
  fs.mkdirSync(BG_TASKS, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
});

/** A file outside bg-tasks/ that must still be there afterwards. */
function sentinel(): string {
  const p = path.join(TEST_WORKDIR, "sentinel.txt");
  fs.writeFileSync(p, "do not delete");
  return p;
}

describe("taskDir traversal", () => {
  it("refuses to delete outside bg-tasks, and the workspace survives", async () => {
    const guard = sentinel();
    await expect(deleteTask("..")).rejects.toThrow(/Invalid task slug/);
    expect(fs.readFileSync(guard, "utf8")).toBe("do not delete");
    expect(fs.existsSync(BG_TASKS)).toBe(true);
  });

  // "" resolved to bg-tasks/ itself, so the recursive delete took every task.
  it("refuses an empty slug rather than deleting the whole root", async () => {
    fs.mkdirSync(path.join(BG_TASKS, "keep-me"), { recursive: true });
    await expect(deleteTask("")).rejects.toThrow(/Invalid task slug/);
    expect(fs.existsSync(path.join(BG_TASKS, "keep-me"))).toBe(true);
  });

  // fetchTask swallows read errors into null by design, so a plain null proves
  // nothing — plant a real, valid task.yaml outside the root and show it stays
  // unreachable.
  it("cannot read a task that exists outside bg-tasks", async () => {
    const outside = path.join(TEST_WORKDIR, "outside-task");
    fs.mkdirSync(outside, { recursive: true });
    fs.copyFileSync(
      path.join(BG_TASKS, (await createTask({ name: "seed", instructions: "x" })).slug, "task.yaml"),
      path.join(outside, "task.yaml"),
    );

    expect(await fetchTask("../outside-task")).toBeNull();
  });

  // writeArtifactSync swallows failures ("sidecar is advisory"), so assert on
  // the filesystem: nothing may appear outside bg-tasks.
  it("writes no sidecar outside bg-tasks", async () => {
    sentinel();
    await writeArtifactSync("../evil", { revision: 1, pulledAt: "" });
    expect(fs.readdirSync(TEST_WORKDIR).sort()).toEqual(["bg-tasks", "sentinel.txt"]);
  });

  it("refuses a nested slug", async () => {
    await expect(readRunIds("sub/nested")).rejects.toThrow(/Invalid task slug/);
  });

  it("still refuses when the traversal only appears after normalization", async () => {
    const guard = sentinel();
    await expect(deleteTask("a/../..")).rejects.toThrow(/Invalid task slug/);
    expect(fs.existsSync(guard)).toBe(true);
  });
});

describe("taskDir accepts every slug listTasks can produce", () => {
  it("round-trips a created task", async () => {
    const { slug } = await createTask({ name: "Morning Email Brief", instructions: "do it" });
    expect(slug).toBe("morning-email-brief");
    expect((await fetchTask(slug))?.name).toBe("Morning Email Brief");
    await deleteTask(slug);
    expect(await fetchTask(slug)).toBeNull();
  });

  // listTasks treats any non-dot directory as a task, so a folder made by hand
  // — capitals, a space — is legitimate. This is what rules out a slugify or
  // charset regex as the guard.
  it("reads a hand-created folder whose name is not slugify output", async () => {
    const { slug } = await createTask({ name: "temp", instructions: "x" });
    const handMade = path.join(BG_TASKS, "My Task");
    fs.mkdirSync(handMade, { recursive: true });
    fs.copyFileSync(path.join(BG_TASKS, slug, "task.yaml"), path.join(handMade, "task.yaml"));

    const listed = (await listTasks()).items.map((t) => t.slug);
    expect(listed).toContain("My Task");
    expect(await fetchTask("My Task")).not.toBeNull();
  });
});
