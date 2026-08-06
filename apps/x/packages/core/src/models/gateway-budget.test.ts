import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import {
  BACKGROUND_BUDGET,
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
    for (const useCase of ["copilot_chat", "dictation_command"]) {
      expect(isInteractive(useCase)).toBe(true);
    }
  });

  it("treats unattended work as background", () => {
    for (const useCase of ["knowledge_sync", "background_task_agent", "live_note_agent"]) {
      expect(isInteractive(useCase)).toBe(false);
    }
  });

  it("paces the bulk half of meeting_note", () => {
    // meeting_note covers both kinds of work. These four run over every email
    // thread and every meeting; treating the use case as wholly interactive let
    // them bypass the queue entirely, which is the opposite of what pacing is
    // for.
    for (const sub of ["contact_extraction", "conversation_extraction", "commitments"]) {
      expect(isInteractive("meeting_note", sub), `${sub} should be paced`).toBe(false);
    }
    // summarize_meeting sets no subUseCase at all.
    expect(isInteractive("meeting_note", undefined)).toBe(false);
  });

  it("still lets someone ask a question about a meeting through", () => {
    expect(isInteractive("meeting_note", "ask")).toBe(true);
  });

  it("treats an unlabelled request as background", () => {
    // Safer default: an unknown caller should not get to skip the queue.
    expect(isInteractive(undefined)).toBe(false);
  });
});

describe("background pacing", () => {
  it("releases at most the interval cap per window", async () => {
    const started: number[] = [];
    const calls = Array.from({ length: 30 }, () =>
      throughBackgroundBudget(async () => {
        started.push(Date.now());
        return ok();
      }),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(started.length).toBe(7);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(started.length).toBe(14);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(started.length).toBe(21);
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.all(calls);
  });

  it("never puts more than the server's window cap into any 10s span", async () => {
    // The server limiter is a fixed window, so its boundary is arbitrary
    // relative to ours. Any 10s slice of our output must fit under the cap
    // whatever the phase offset, or a third of a burst gets rejected on timing
    // alone.
    const started: number[] = [];
    Array.from({ length: 300 }, () =>
      throughBackgroundBudget(async () => {
        started.push(Date.now());
        return ok();
      }).catch(() => {}),
    );
    await vi.advanceTimersByTimeAsync(40_000);

    const SERVER_WINDOW_MS = 10_000;
    const SERVER_CAP = 100;
    let worst = 0;
    for (const t of started) {
      const inWindow = started.filter((u) => u >= t && u < t + SERVER_WINDOW_MS).length;
      worst = Math.max(worst, inWindow);
    }
    expect(worst, `worst 10s span held ${worst} requests`).toBeLessThanOrEqual(SERVER_CAP);
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

  it("trips on the client-side failures that strand a desktop", () => {
    // The failures that actually keep an app stuck are permanent and 4xx: an
    // account out of credits, a model missing from the gateway allowlist, dead
    // auth. Every request fails identically and no retry helps, so a breaker
    // that only watches 5xx would let the queue grind through hundreds of them.
    for (const status of [402, 400, 401, 403, 404]) {
      resetBackgroundBudgetForTests();
      for (let i = 0; i < 5; i++) recordBackgroundOutcome(status);
      expect(backgroundQueueStats().paused, `status ${status} should trip the breaker`).toBe(true);
    }
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
    const guard = source.indexOf("if (isInteractive(ctx?.useCase, ctx?.subUseCase))");
    expect(guard, "authedFetch must branch on isInteractive, passing both fields").toBeGreaterThan(-1);

    const queued = source.indexOf("throughBackgroundBudget", guard);
    const bypass = source.indexOf("return fetch(", guard);
    expect(bypass, "the interactive branch returns fetch directly").toBeGreaterThan(-1);
    expect(bypass, "the bypass comes before the queued path").toBeLessThan(queued);
  });

  it("still queues everything else", () => {
    expect(source).toMatch(/return throughBackgroundBudget\(\(\) => fetch\(/);
  });
});

describe("background leaves the server ceiling a reserve", () => {
  // The client cap and the server cap live in different languages in different
  // processes. Reading the Go config here is the only way to notice when one
  // moves and the other does not — and the failure mode is silent: background
  // work quietly consuming the allowance a waiting user needs.
  const goConfig = fs.readFileSync(
    new URL("../../../../../rowboat-api/internal/appconfig/config.go", import.meta.url),
    "utf8",
  );

  function serverDefault(env: string): number {
    const m = goConfig.match(new RegExp(`getint\\("${env}",\\s*(\\d+)\\)`));
    expect(m, `${env} not found in config.go`).not.toBeNull();
    return Number(m![1]);
  }

  it("stays under the server's 10s burst allowance", () => {
    const serverBurst = serverDefault("LLM_RATE_LIMIT_PER_USER_BURST_PER_10S");
    expect(BACKGROUND_BUDGET.perInterval).toBeLessThan(serverBurst);
  });

  it("leaves enough for a Copilot turn", () => {
    // An interactive agent loop can be ~30 calls in ten seconds. If the reserve
    // drops below that, a user asking a question starts getting rate limited
    // while background labeling runs — the regression this module exists for.
    const serverBurst = serverDefault("LLM_RATE_LIMIT_PER_USER_BURST_PER_10S");
    const reserve = serverBurst - BACKGROUND_BUDGET.perInterval;
    expect(reserve).toBeGreaterThanOrEqual(30);
  });

  it("does not open more sockets than the gateway will forward", () => {
    // The gateway caps its own outbound fan-out; exceeding it just queues
    // inside the server instead.
    const llmMaxConcurrent = serverDefault("LLM_MAX_CONCURRENT");
    expect(BACKGROUND_BUDGET.concurrency).toBeLessThanOrEqual(llmMaxConcurrent);
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
