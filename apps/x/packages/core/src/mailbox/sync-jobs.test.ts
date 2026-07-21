import { describe, expect, it } from "vitest";

import { computeMailboxBackoff } from "./sync-jobs.js";

describe("computeMailboxBackoff", () => {
  const noJitter = () => 0;

  it("grows exponentially with attempt", () => {
    const now = 0;
    const a1 = computeMailboxBackoff({ attempt: 1, now, random: noJitter });
    const a2 = computeMailboxBackoff({ attempt: 2, now, random: noJitter });
    const a3 = computeMailboxBackoff({ attempt: 3, now, random: noJitter });
    expect(a2).toBeGreaterThan(a1);
    expect(a3).toBeGreaterThan(a2);
  });

  it("never exceeds the max backoff", () => {
    const now = 0;
    const huge = computeMailboxBackoff({
      attempt: 20,
      now,
      maxBackoffMs: 60_000,
      random: noJitter,
    });
    expect(huge).toBeLessThanOrEqual(60_000);
  });

  it("floors at the provider retry-after", () => {
    const now = 1_000;
    const retry = computeMailboxBackoff({
      attempt: 1,
      now,
      retryAfterMs: 60_000,
      random: noJitter,
    });
    expect(retry).toBe(now + 60_000);
  });
});
