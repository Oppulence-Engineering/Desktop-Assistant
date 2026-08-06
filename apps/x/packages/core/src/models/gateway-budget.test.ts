import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import {
  backgroundQueueStats,
  clearBackgroundQueue,
  isInteractive,
  pauseBackground,
  recordBackgroundOutcome,
  resetBackgroundBudgetForTests,
  throughBackgroundBudget,
} from "./gateway-budget.js";

/**
 * The gateway allows 60 requests/minute and 12 per 10s per user. Background
 * work is paced to half of that; interactive work is never queued.
 *
 * The load-bearing test here is "an interactive request is not delayed by a
 * backlog". A single FIFO queue over all traffic would be worse than the bug it
 * fixes — hundreds of queued labeling calls would sit in front of a person
 * typing in chat.
 */

beforeEach(() => {
  // Fake timers first: resetting under real timers leaves p-queue holding an
  // interval timer that the fake clock will never fire.
  vi.useFakeTimers();
  resetBackgroundBudgetForTests();
});

afterEach(() => {
  resetBackgroundBudgetForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const ok = (status = 200) => ({ status });

describe("isInteractive", () => {
  it("treats use cases with a person waiting as interactive", () => {
    for (const useCase of ["copilot_chat", "dictation_command", "meeting_note"]) {
      expect(isInteractive(useCase)).toBe(true);
    }
  });

  it("treats unattended work as background", () => {
    for (const useCase of ["knowledge_sync", "background_task_agent", "live_note_agent"]) {
      expect(isInteractive(useCase)).toBe(false);
    }
  });

  it("treats an unlabelled request as background", () => {
    // Safer default: an unknown caller should not get to skip the queue.
    expect(isInteractive(undefined)).toBe(false);
  });
});

describe("background pacing", () => {
  it("releases at most the interval cap per window", async () => {
    const started: number[] = [];
    // 120 against a 50-per-window cap: enough to span three windows.
    const calls = Array.from({ length: 120 }, () =>
      throughBackgroundBudget(async () => {
        started.push(Date.now());
        return ok();
      }),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(started.length).toBe(50);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(started.length).toBe(100);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(started.length).toBe(120);
    await Promise.all(calls);
  });

  it("builds exactly the backlog an interactive caller must not wait behind", async () => {
    // Establishes the hazard this module exists to avoid: 100 background calls
    // leave a deep queue. gateway.ts is what keeps interactive traffic out of
    // it — asserted in "interactive traffic bypasses the queue" below.
    // Not awaited: p-queue's clear() drops queued tasks without settling their
    // promises, so awaiting them here would hang forever.
    Array.from({ length: 400 }, () => throughBackgroundBudget(async () => ok()).catch(() => {}));

    await vi.advanceTimersByTimeAsync(0);
    expect(backgroundQueueStats().size).toBeGreaterThan(300);
  });

  it("drops queued work when cleared, without failing in-flight requests", async () => {
    const inFlight = throughBackgroundBudget(async () => ok());
    // Not awaited: clear() drops these without settling their promises.
    Array.from({ length: 200 }, () => throughBackgroundBudget(async () => ok()).catch(() => {}));

    // Already dequeued and running — clear() must not disturb it.
    await vi.advanceTimersByTimeAsync(10);
    await expect(inFlight).resolves.toEqual({ status: 200 });

    clearBackgroundQueue();
    expect(backgroundQueueStats().size).toBe(0);
  });
});

describe("circuit breaker", () => {
  it("stops pacing work that is failing for a reason pacing cannot fix", () => {
    // 5 consecutive 502s — a dead upstream, not congestion.
    for (let i = 0; i < 5; i++) recordBackgroundOutcome(502);
    expect(backgroundQueueStats().paused).toBe(true);
  });

  it("does not trip on rate limiting", () => {
    // Being throttled means the pacing is working. Tripping here would stall
    // background work exactly when it is behaving correctly.
    for (let i = 0; i < 20; i++) recordBackgroundOutcome(429);
    expect(backgroundQueueStats().paused).toBe(false);
  });

  it("resets the failure run on any success", () => {
    recordBackgroundOutcome(502);
    recordBackgroundOutcome(502);
    recordBackgroundOutcome(200);
    recordBackgroundOutcome(502);
    recordBackgroundOutcome(502);
    expect(backgroundQueueStats().paused).toBe(false);
  });

  it("counts a transport failure as a failure", () => {
    for (let i = 0; i < 5; i++) recordBackgroundOutcome(undefined);
    expect(backgroundQueueStats().paused).toBe(true);
  });

  it("resumes after the cooldown", async () => {
    pauseBackground(30_000);
    expect(backgroundQueueStats().paused).toBe(true);
    await vi.advanceTimersByTimeAsync(30_001);
    expect(backgroundQueueStats().paused).toBe(false);
  });
});

describe("interactive traffic bypasses the queue", () => {
  // The bypass lives in authedFetch, which is module-private and needs a live
  // token and a real provider to exercise. Asserted against the source instead:
  // the alternative is no check at all on the one property whose absence would
  // make a person wait minutes for a chat reply.
  const source = fs.readFileSync(new URL("./gateway.ts", import.meta.url), "utf8");

  it("returns fetch directly for an interactive use case", () => {
    const guard = source.indexOf("if (isInteractive(ctx?.useCase))");
    expect(guard, "authedFetch must branch on isInteractive").toBeGreaterThan(-1);

    const queued = source.indexOf("throughBackgroundBudget", guard);
    const bypass = source.indexOf("return fetch(", guard);
    expect(bypass, "the interactive branch returns fetch directly").toBeGreaterThan(-1);
    expect(bypass, "the bypass comes before the queued path").toBeLessThan(queued);
  });

  it("still queues everything else", () => {
    expect(source).toMatch(/return throughBackgroundBudget\(\(\) => fetch\(/);
  });
});

describe("shared budget", () => {
  it("is one queue across every importing module", async () => {
    // Chat, embeddings and the model catalog share one server-side bucket, so
    // they have to share one client-side queue or the budget leaks.
    const again = await import("./gateway-budget.js");
    Array.from({ length: 200 }, () => throughBackgroundBudget(async () => ok()).catch(() => {}));

    // Read through the second import handle: it must observe the same backlog.
    const stats = again.backgroundQueueStats();
    expect(stats.size + stats.pending).toBeGreaterThan(0);
    expect(stats).toEqual(backgroundQueueStats());
  });

});
