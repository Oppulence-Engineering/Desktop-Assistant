import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";

const TEST_WORKDIR = vi.hoisted(() => "/tmp/rowboat-runs-fetch-test");
vi.mock("../config/config.js", () => ({ WorkDir: TEST_WORKDIR }));

import { FSRunsRepo } from "./repo.js";

/**
 * One malformed line must not make a run unopenable.
 *
 * fetch() used to map every line through `ReadRunEvent.parse(JSON.parse(line))`
 * with no per-line guard. A crash mid-write leaves a truncated final line, and
 * that single line made the whole run throw on every read — including from
 * authorizePermission, which fetches the run to decide a pending tool call.
 * The sibling readRunMetadata in the same file already tolerated malformed
 * lines; fetch was the one that did not.
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
const MESSAGE = JSON.stringify({
  runId: RUN_ID,
  type: "message",
  messageId: "m1",
  subflow: [],
  message: { role: "user", content: "hello" },
});

function repo(): FSRunsRepo {
  return new FSRunsRepo({ idGenerator: { next: async () => "id" } });
}

beforeEach(async () => {
  await fs.rm(TEST_WORKDIR, { recursive: true, force: true });
  await fs.mkdir(RUNS, { recursive: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(TEST_WORKDIR, { recursive: true, force: true }).catch(() => {});
});

describe("FSRunsRepo.fetch", () => {
  it("reads an intact run", async () => {
    await fs.writeFile(path.join(RUNS, `${RUN_ID}.jsonl`), `${START}\n${MESSAGE}\n`);
    const run = await repo().fetch(RUN_ID);
    expect(run.id).toBe(RUN_ID);
    // log carries the start event plus the message — assert on both, because a
    // lenient parser that silently dropped the message would also report a
    // plausible-looking length.
    expect(run.log.map((e) => e.type)).toEqual(["start", "message"]);
  });

  // The crash-mid-write artifact: the last line stops partway through.
  it("survives a truncated final line instead of refusing the whole run", async () => {
    await fs.writeFile(
      path.join(RUNS, `${RUN_ID}.jsonl`),
      `${START}\n${MESSAGE}\n{"runId":"${RUN_ID}","type":"mess`,
    );
    const run = await repo().fetch(RUN_ID);
    expect(run.log.map((e) => e.type)).toEqual(["start", "message"]); // intact events survive
  });

  it("skips a malformed middle line and keeps the rest", async () => {
    await fs.writeFile(
      path.join(RUNS, `${RUN_ID}.jsonl`),
      `${START}\nnot json at all\n${MESSAGE}\n`,
    );
    const run = await repo().fetch(RUN_ID);
    expect(run.log.map((e) => e.type)).toEqual(["start", "message"]);
  });

  // If nothing valid remains there is nothing to open; the controlled error
  // must still fire rather than something undefined-shaped leaking out.
  it("still reports a run with no usable start event as corrupt", async () => {
    await fs.writeFile(path.join(RUNS, `${RUN_ID}.jsonl`), `{"trunc`);
    await expect(repo().fetch(RUN_ID)).rejects.toThrow(/Corrupt run data/);
  });
});
