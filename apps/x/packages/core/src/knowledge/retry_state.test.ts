import { describe, it, expect } from "vitest";
import {
  MAX_ATTEMPTS,
  abandoned,
  clearFailure,
  recordFailure,
  shouldRetry,
  type RetryMap,
} from "./retry_state.js";

/**
 * The knowledge services all pick work by asking "what isn't done yet" and all
 * recorded successes only, so anything that failed was re-selected on every
 * poll, forever, at full token cost. Measured live in two of them at once:
 * 1,342 emails eligible on every 15-second tick (~21,600 credits per sweep
 * against a 10,000/day allowance) and the same four notes re-detected as
 * "changed" on eight consecutive syncs.
 */

const KEY = "/w/knowledge/note.md";
const MINUTE = 60_000;

describe("shouldRetry", () => {
  it("allows an item with no history", () => {
    expect(shouldRetry(KEY, undefined)).toBe(true);
    expect(shouldRetry(KEY, {})).toBe(true);
  });

  it("holds an item back immediately after a failure", () => {
    const now = Date.now();
    const failures = recordFailure(KEY, undefined, new Date(now));
    expect(shouldRetry(KEY, failures, now + 1_000)).toBe(false);
  });

  it("lets it through once the window passes", () => {
    const now = Date.now();
    const failures = recordFailure(KEY, undefined, new Date(now));
    expect(shouldRetry(KEY, failures, now + 6 * MINUTE)).toBe(true);
  });

  // Transient failures should come back — just further and further apart.
  it("widens the window with each failure", () => {
    const now = Date.now();
    let failures: RetryMap = recordFailure(KEY, undefined, new Date(now));
    failures = recordFailure(KEY, failures, new Date(now));
    expect(shouldRetry(KEY, failures, now + 6 * MINUTE)).toBe(false);
    expect(shouldRetry(KEY, failures, now + 11 * MINUTE)).toBe(true);
  });

  it("stops permanently at the cap", () => {
    const now = Date.now();
    let failures: RetryMap = {};
    for (let i = 0; i < MAX_ATTEMPTS; i++) failures = recordFailure(KEY, failures, new Date(now));
    expect(shouldRetry(KEY, failures, now + 365 * 24 * 60 * MINUTE)).toBe(false);
    expect(abandoned(failures)).toEqual([KEY]);
  });

  it("caps the backoff so an item is not deferred beyond its attempts", () => {
    const now = Date.now();
    let failures: RetryMap = {};
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) failures = recordFailure(KEY, failures, new Date(now));
    // 6h cap, not 5min * 2^3 growing unbounded.
    expect(shouldRetry(KEY, failures, now + 7 * 60 * MINUTE)).toBe(true);
  });
});

describe("clearFailure", () => {
  it("forgets history so an intermittent item is not half-condemned", () => {
    let failures: RetryMap = recordFailure(KEY, undefined);
    failures = recordFailure(KEY, failures);
    clearFailure(KEY, failures);
    expect(shouldRetry(KEY, failures)).toBe(true);
    expect(abandoned(failures)).toEqual([]);
  });

  it("tolerates an absent map", () => {
    expect(() => clearFailure(KEY, undefined)).not.toThrow();
  });
});
