import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

const TEST_WORKDIR = vi.hoisted(() => "/tmp/rowboat-runs-traversal-test");
vi.mock("../config/config.js", () => ({ WorkDir: TEST_WORKDIR }));

import { FSRunsRepo } from "./repo.js";

/**
 * runId reaches runLogPath straight from the renderer — `runs:fetch`,
 * `runs:delete` and `runs:createMessage` all type it as a bare `z.string()` —
 * and path.join does not reset on "..", so "../../x" escaped the runs
 * directory: an arbitrary *.jsonl read returned to the renderer, an arbitrary
 * unlink, and an arbitrary append. The sibling channel `runs:downloadLog`
 * already applied the basename check these three were missing.
 *
 * The legitimate cases matter as much as the hostile ones: `list()` derives run
 * ids from any *.jsonl basename, so a guard tighter than basename-equality
 * would produce runs that appear in the list and then fail to open.
 */

const RUNS = path.join(TEST_WORKDIR, "runs");
const RUN_ID = "2026-08-07T00-00-00Z-0000001-000";

const START = JSON.stringify({
  type: "start",
  runId: RUN_ID,
  agentName: "copilot",
  model: "anthropic/claude-haiku-4-5",
  provider: "solomon",
  permissionMode: "manual",
  useCase: "copilot_chat",
  subflow: [],
  ts: "2026-08-07T00:00:00.000Z",
});

function repo(): FSRunsRepo {
  return new FSRunsRepo({ idGenerator: { next: async () => "id" } });
}

/** A valid run log placed OUTSIDE the runs directory, as a traversal target. */
function plantOutsideRun(name: string): string {
  const p = path.join(TEST_WORKDIR, `${name}.jsonl`);
  fs.writeFileSync(p, `${START}\n`);
  return p;
}

beforeEach(async () => {
  // FSRunsRepo's constructor fires an un-awaited fsp.mkdir (repo.ts:94), so a
  // previous test can still have one in flight. Let it land before wiping, or
  // it recreates the tree underneath the next test.
  await new Promise((resolve) => setImmediate(resolve));
  fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
  fs.mkdirSync(RUNS, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
});

describe("runLogPath traversal", () => {
  it("refuses to read a run outside the runs directory", async () => {
    plantOutsideRun("outside");
    await expect(repo().fetch("../outside")).rejects.toThrow(/Invalid run id/);
  });

  // The sentinel is the assertion that matters: a rejected promise proves
  // nothing if the unlink already happened.
  it("refuses to delete outside the runs directory, and the file survives", async () => {
    const victim = plantOutsideRun("victim");
    await expect(repo().delete("../victim")).rejects.toThrow(/Invalid run id/);
    expect(fs.existsSync(victim)).toBe(true);
  });

  it("refuses to append outside the runs directory, leaving the file untouched", async () => {
    const victim = plantOutsideRun("appendee");
    const before = fs.readFileSync(victim, "utf8");

    await expect(
      repo().appendEvents("../appendee", [
        { runId: "x", type: "message", messageId: "m", subflow: [], message: { role: "user", content: "hi" } },
      ] as never),
    ).rejects.toThrow(/Invalid run id/);

    expect(fs.readFileSync(victim, "utf8")).toBe(before);
  });

  it("refuses a nested path even without a leading ..", async () => {
    fs.mkdirSync(path.join(RUNS, "sub"), { recursive: true });
    fs.writeFileSync(path.join(RUNS, "sub", "nested.jsonl"), `${START}\n`);
    await expect(repo().fetch("sub/nested")).rejects.toThrow(/Invalid run id/);
  });
});

describe("runLogPath accepts every id the run list can produce", () => {
  it("reads a run with a generated id", async () => {
    fs.writeFileSync(path.join(RUNS, `${RUN_ID}.jsonl`), `${START}\n`);
    expect((await repo().fetch(RUN_ID)).id).toBe(RUN_ID);
  });

  // list() surfaces any *.jsonl basename, so an id that does not match the
  // IdGen format must still open — this is what rules out a format regex.
  it("reads a run whose id was not produced by IdGen", async () => {
    const odd = "imported-run_01";
    fs.writeFileSync(
      path.join(RUNS, `${odd}.jsonl`),
      `${JSON.stringify({ ...JSON.parse(START), runId: odd })}\n`,
    );
    expect((await repo().fetch(odd)).id).toBe(odd);
  });

  it("deletes a legitimate run", async () => {
    const file = path.join(RUNS, `${RUN_ID}.jsonl`);
    fs.writeFileSync(file, `${START}\n`);
    await repo().delete(RUN_ID);
    expect(fs.existsSync(file)).toBe(false);
  });
});
