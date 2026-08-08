import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

const TEST_WORKDIR = vi.hoisted(() => "/tmp/rowboat-agent-notes-test");
vi.mock("../config/config.js", () => ({ WorkDir: TEST_WORKDIR }));

// No user email → the email leg of the pass is skipped; these tests are about runs.
vi.mock("../config/user_config.js", () => ({
  loadUserConfig: () => null,
  updateUserEmail: () => {},
}));
vi.mock("./google-client-factory.js", () => ({
  GoogleClientFactory: { getClient: async () => null },
}));
// Signed out → shouldSkipForProductAuth returns false without touching tokens.
vi.mock("../account/account.js", () => ({ isSignedIn: async () => false }));
vi.mock("../auth/tokens.js", () => ({
  getAccessToken: async () => "t",
  getAuthState: () => ({ state: "idle" }),
}));
vi.mock("../models/defaults.js", () => ({ getKgModel: async () => "test-model" }));

const agentRun = vi.hoisted(() => ({ failNext: false }));
vi.mock("../runs/runs.js", () => ({
  createRun: async () => ({ id: "run-1" }),
  createMessage: async () => {},
}));
vi.mock("../agents/utils.js", () => ({
  getErrorDetails: (e: unknown) => String(e),
  waitForRunCompletion: async () => {
    if (agentRun.failNext) throw new Error("agent run failed");
  },
}));

import { findNewCopilotRuns, processAgentNotes } from "./agent_notes.js";
import { loadAgentNotesState } from "./agent_notes_state.js";

/**
 * Only what was sent to the agent may be marked as learned-from.
 *
 * processAgentNotes takes the last RUNS_BATCH_SIZE (5) of the new copilot runs
 * into the prompt, but used to mark ALL of newRuns processed. With 8 pending,
 * 3 were recorded as learned-from having never been sent — and since selection
 * skips processed runs, they were never revisited. Silent, permanent data loss
 * for the agent-notes memory.
 *
 * The failure path is the sibling immortal-retry bug: nothing was recorded, so
 * the identical batch was re-sent to the LLM every 10 seconds (the fastest
 * poll of any service) until it happened to work.
 */

const RUNS = path.join(TEST_WORKDIR, "runs");

function writeCopilotRun(name: string): void {
  // A start line naming the agent, plus a real message — a run with no
  // conversation contributes nothing and the whole pass early-returns.
  fs.writeFileSync(
    path.join(RUNS, `${name}.jsonl`),
    JSON.stringify({ type: "start", agentName: "copilot", runId: name }) +
      "\n" +
      JSON.stringify({ type: "message", message: { role: "user", content: `hello from ${name}` } }) +
      "\n",
  );
}

beforeEach(() => {
  agentRun.failNext = false;
  fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
  fs.mkdirSync(RUNS, { recursive: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
});

describe("processAgentNotes — run batching", () => {
  it("marks only the runs that were sent to the agent, keeping the rest eligible", async () => {
    for (let i = 1; i <= 8; i++) writeCopilotRun(`run-0${i}`);

    await processAgentNotes();

    const state = loadAgentNotesState();
    const processed = Object.keys(state.processedRuns).sort();
    // slice(-5) of the sorted list: the last five.
    expect(processed).toEqual(["run-04.jsonl", "run-05.jsonl", "run-06.jsonl", "run-07.jsonl", "run-08.jsonl"]);

    // The overflow is still eligible for the next pass, not silently lost.
    expect(findNewCopilotRuns(state).sort()).toEqual([
      "run-01.jsonl",
      "run-02.jsonl",
      "run-03.jsonl",
    ]);
  });

  it("records failures instead of leaving a failed batch immortal", async () => {
    for (let i = 1; i <= 8; i++) writeCopilotRun(`run-0${i}`);
    agentRun.failNext = true;

    await processAgentNotes();

    const state = loadAgentNotesState();
    expect(Object.keys(state.processedRuns)).toEqual([]);
    // The five that were in the failed pass are backing off…
    expect(Object.keys(state.failures ?? {}).sort()).toEqual([
      "run-04.jsonl",
      "run-05.jsonl",
      "run-06.jsonl",
      "run-07.jsonl",
      "run-08.jsonl",
    ]);
    // …so the next selection is the three that were never attempted.
    expect(findNewCopilotRuns(state).sort()).toEqual([
      "run-01.jsonl",
      "run-02.jsonl",
      "run-03.jsonl",
    ]);
  });

  it("marks everything when the pending set fits in one batch", async () => {
    for (let i = 1; i <= 3; i++) writeCopilotRun(`run-0${i}`);

    await processAgentNotes();

    const state = loadAgentNotesState();
    expect(Object.keys(state.processedRuns).sort()).toEqual([
      "run-01.jsonl",
      "run-02.jsonl",
      "run-03.jsonl",
    ]);
    expect(findNewCopilotRuns(state)).toEqual([]);
  });
});
