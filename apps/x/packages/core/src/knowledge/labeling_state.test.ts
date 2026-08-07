import { describe, it, expect, vi } from "vitest";

const TEST_WORKDIR = vi.hoisted(() => "/tmp/rowboat-labeling-state-test");
vi.mock("../config/config.js", () => ({ WorkDir: TEST_WORKDIR }));

import {
  MAX_LABEL_ATTEMPTS,
  abandonedFiles,
  markAttemptFailed,
  markFileAsLabeled,
  shouldAttempt,
  type LabelingState,
} from "./labeling_state.js";

/**
 * A file the agent cannot label must stop costing money.
 *
 * State used to record successes only, so anything that failed came back on the
 * very next poll — every 15 seconds, forever. On a real workspace that was 1,342
 * files re-sent at ~30k input tokens per 15-file batch: ~21,600 credits for a
 * single sweep against a 10,000/day allowance, and the sweep restarted the
 * moment it finished. The account was exhausted twice over by one pass.
 */

const FILE = "/w/gmail_sync/thread-1.md";
const MINUTE = 60_000;

function state(): LabelingState {
  return { processedFiles: {}, lastRunTime: new Date(0).toISOString() };
}

describe("shouldAttempt", () => {
  it("allows a file that has never been tried", () => {
    expect(shouldAttempt(FILE, state())).toBe(true);
  });

  // The point of the whole change: a fresh failure must not be retried on the
  // next 15-second tick.
  it("holds a file back immediately after a failure", () => {
    const s = state();
    const now = Date.now();
    markAttemptFailed(FILE, s, new Date(now));
    expect(shouldAttempt(FILE, s, now + 1_000)).toBe(false);
  });

  it("lets it through once the backoff window passes", () => {
    const s = state();
    const now = Date.now();
    markAttemptFailed(FILE, s, new Date(now));
    expect(shouldAttempt(FILE, s, now + 6 * MINUTE)).toBe(true);
  });

  // Transient failures (expired bearer, exhausted balance, vendor 502) should
  // come back — just further and further apart.
  it("backs off exponentially rather than at a fixed interval", () => {
    const s = state();
    const now = Date.now();
    markAttemptFailed(FILE, s, new Date(now));
    markAttemptFailed(FILE, s, new Date(now));
    // Two failures → ~10 minutes, so the 6-minute window that sufficed for one
    // is no longer enough.
    expect(shouldAttempt(FILE, s, now + 6 * MINUTE)).toBe(false);
    expect(shouldAttempt(FILE, s, now + 11 * MINUTE)).toBe(true);
  });

  it("stops entirely at the attempt cap, however long we wait", () => {
    const s = state();
    const now = Date.now();
    for (let i = 0; i < MAX_LABEL_ATTEMPTS; i++) markAttemptFailed(FILE, s, new Date(now));
    expect(shouldAttempt(FILE, s, now + 365 * 24 * 60 * MINUTE)).toBe(false);
    expect(abandonedFiles(s)).toEqual([FILE]);
  });
});

describe("markFileAsLabeled", () => {
  it("clears the failure history so an intermittent file is not half-condemned", () => {
    const s = state();
    markAttemptFailed(FILE, s);
    markAttemptFailed(FILE, s);
    markFileAsLabeled(FILE, s);

    expect(s.processedFiles[FILE]).toBeTruthy();
    expect(s.failures?.[FILE]).toBeUndefined();
    expect(shouldAttempt(FILE, s)).toBe(true);
  });
});

describe("backward compatibility", () => {
  // The field is optional because every existing install has a state file
  // written before it existed; treating "no history" as "never tried" is what
  // keeps those workspaces working.
  it("treats a state file with no failures block as all-eligible", () => {
    const legacy = { processedFiles: {}, lastRunTime: "" } as LabelingState;
    expect(shouldAttempt(FILE, legacy)).toBe(true);
    expect(abandonedFiles(legacy)).toEqual([]);
  });
});
