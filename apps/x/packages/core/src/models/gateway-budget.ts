import PQueue from "p-queue";
import type { UseCase } from "../analytics/use_case.js";

/**
 * Shapes background LLM traffic to fit the gateway's per-user budget, without
 * ever making a waiting user queue behind it.
 *
 * The gateway allows 60 requests/minute and 12 per 10s per user
 * (rowboat-api cmd/server/wire.go: GroupLLM + GroupLLMBurst). The desktop
 * routinely wants far more than that: one email-labeling batch is a tool-using
 * agent over 15 files — roughly 15 reads and 15 edits, each its own round trip
 * — and three batches run at once alongside note tagging, graph builds and
 * embeddings. Bursts of 5-10x the budget are normal, so requests were rejected
 * faster than the AI SDK's three retries could absorb, and whole batches were
 * reported to the user as failures.
 *
 * Two rules, and the second matters more than the first:
 *
 *   1. Background work is paced to half the budget.
 *   2. Interactive work is never queued at all.
 *
 * Rule 2 is the point. A single FIFO queue over all traffic would be worse than
 * the bug it fixes: a labeling run enqueues hundreds of calls, and a person
 * typing in chat would land behind every one of them and wait minutes for a
 * reply. Today that person is served fine and only background work fails.
 * Capping background at half leaves the rest permanently free, so an
 * interactive request goes straight out and its slot cannot have been taken.
 */

/** Requests a person is actively waiting on. Never queued. */
const INTERACTIVE_USE_CASES: ReadonlySet<string> = new Set<UseCase>([
  "copilot_chat",
  "dictation_command",
  "meeting_note",
]);

export function isInteractive(useCase: string | undefined): boolean {
  return useCase !== undefined && INTERACTIVE_USE_CASES.has(useCase);
}

// The gateway allows 100 per 10s and 600/min per user
// (LLM_RATE_LIMIT_PER_USER_*). Both work out to the same 10-per-second ceiling,
// so the 10s window is the binding constraint and the only number to reason
// about.
//
// Background takes 70 of those 100, leaving 30 per 10s for interactive traffic,
// which is never queued at all. That reserve is sized off what a person can
// actually generate: a Copilot turn is one agent loop, and 30 calls in ten
// seconds is a fast one. Background gets the rest, because it is the thing with
// hundreds of calls to make.
//
// The reserve exists so a labeling backlog can never put a waiting user behind
// it. Handing background the whole ceiling would reintroduce exactly that, and
// leaving it at half was simply leaving throughput unused.
//
// Concurrency is capped separately: the limits are per window, but the desktop
// opening 70 sockets at once helps nobody, and the gateway bounds its own
// outbound fan-out at LLM_MAX_CONCURRENT regardless.
const BACKGROUND_INTERVAL_MS = 10_000;
const BACKGROUND_PER_INTERVAL = 70;
const BACKGROUND_CONCURRENCY = 12;

function newQueue(): PQueue {
  return new PQueue({
    concurrency: BACKGROUND_CONCURRENCY,
    intervalCap: BACKGROUND_PER_INTERVAL,
    interval: BACKGROUND_INTERVAL_MS,
  });
}

let queue = newQueue();

/**
 * Circuit breaker.
 *
 * When the gateway is failing for a reason pacing cannot fix — a dead upstream
 * key, an undeployed route — the queue would otherwise pace thousands of
 * guaranteed failures over tens of minutes, each with its own SDK retries,
 * holding the queue and draining the battery. After a run of failures it stops
 * trying for a while instead.
 *
 * Rate-limit responses are deliberately *not* counted: being throttled means
 * the pacing is working, not that the gateway is broken.
 */
const BREAKER_THRESHOLD = 5;
const BREAKER_BASE_COOLDOWN_MS = 30_000;
const BREAKER_MAX_COOLDOWN_MS = 5 * 60_000;

let consecutiveFailures = 0;
let cooldownMs = BREAKER_BASE_COOLDOWN_MS;
let resumeTimer: ReturnType<typeof setTimeout> | null = null;

/** Hold background work for `ms`. Interactive traffic is unaffected. */
export function pauseBackground(ms: number): void {
  queue.pause();
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => {
    resumeTimer = null;
    queue.start();
  }, ms);
  // Don't hold the event loop open for a paused queue at quit time.
  resumeTimer.unref?.();
}

/**
 * Record how a background request went, so the breaker can open and close.
 * `status` is the HTTP status, or undefined for a transport-level failure.
 */
export function recordBackgroundOutcome(status: number | undefined): void {
  const rateLimited = status === 429;
  const failed = status === undefined || status >= 500;

  if (!failed || rateLimited) {
    consecutiveFailures = 0;
    cooldownMs = BREAKER_BASE_COOLDOWN_MS;
    return;
  }

  consecutiveFailures += 1;
  if (consecutiveFailures >= BREAKER_THRESHOLD) {
    consecutiveFailures = 0;
    pauseBackground(cooldownMs);
    cooldownMs = Math.min(cooldownMs * 2, BREAKER_MAX_COOLDOWN_MS);
  }
}

/**
 * Run a background gateway request under the shared budget.
 *
 * Wrap the individual HTTP request, never a whole generateText() call: the AI
 * SDK retries inside that call, so queueing at the outer level would let one
 * queued item issue three requests and quietly triple the real rate.
 */
export async function throughBackgroundBudget<T extends { status?: number }>(
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const result = await queue.add(fn);
    recordBackgroundOutcome(result.status);
    return result;
  } catch (err) {
    // Transport-level failure (offline, DNS, abort) — no status to read.
    recordBackgroundOutcome(undefined);
    throw err;
  }
}

/**
 * Drop pending background work (app quit). In-flight requests finish.
 *
 * Deliberately leaves a tripped breaker tripped: clearing the backlog is not
 * evidence the gateway recovered, and silently resuming would send the next
 * batch of work straight back into whatever was failing.
 */
export function clearBackgroundQueue(): void {
  queue.clear();
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
}

/**
 * Return the module to its initial state. Tests only — the queue and breaker
 * are process-wide singletons by design, which is exactly what makes them
 * leak between test cases without this.
 */
export function resetBackgroundBudgetForTests(): void {
  clearBackgroundQueue();
  consecutiveFailures = 0;
  cooldownMs = BREAKER_BASE_COOLDOWN_MS;
  // A fresh instance, not queue.start(): clear() does not reset p-queue's
  // interval accounting, so a reused queue still believes it has spent this
  // window's allowance and waits on a timer from the previous test's clock.
  queue = newQueue();
}

/**
 * What background work is allowed to spend, in requests per 10s window.
 *
 * Exported so the gap between this and the server's own ceiling can be
 * asserted: the reserve is the whole design, and it is easy to erase by
 * raising one number.
 */
export const BACKGROUND_BUDGET = {
  perInterval: BACKGROUND_PER_INTERVAL,
  intervalMs: BACKGROUND_INTERVAL_MS,
  concurrency: BACKGROUND_CONCURRENCY,
} as const;

/** Test/diagnostic view of the shared queue. */
export function backgroundQueueStats(): { pending: number; size: number; paused: boolean } {
  return { pending: queue.pending, size: queue.size, paused: queue.isPaused };
}
