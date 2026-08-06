import PQueue from "p-queue";
import type { UseCase } from "../analytics/use_case.js";

/**
 * Shapes background LLM traffic to fit the gateway's per-user budget, without
 * ever making a waiting user queue behind it.
 *
 * The gateway allows 600 requests/minute and 100 per 10s per user
 * (rowboat-api cmd/server/wire.go, LLM_RATE_LIMIT_PER_USER_*). The desktop can
 * still want more: one email-labeling batch is a tool-using agent over 15 files
 * — roughly 15 reads and 15 edits, each its own round trip — and three batches
 * run at once alongside note tagging, graph builds and embeddings. Before the
 * ceiling was raised this overshot by 5-10x, requests were rejected faster than
 * the AI SDK's three retries could absorb, and whole batches were reported to
 * the user as failures.
 *
 * Two rules, and the second matters more than the first:
 *
 *   1. Background work is paced below the ceiling, at 7/s (420/min).
 *   2. Interactive work is never queued at all.
 *
 * Rule 2 is the point. A single FIFO queue over all traffic would be worse than
 * the bug it fixes: a labeling run enqueues hundreds of calls, and a person
 * typing in chat would land behind every one of them and wait minutes for a
 * reply. Today that person is served fine and only background work fails.
 * Leaving headroom above the background rate keeps that path permanently clear,
 * so an interactive request goes straight out and its slot cannot have been
 * taken.
 */

/** Use cases that are always someone waiting on an answer. */
const INTERACTIVE_USE_CASES: ReadonlySet<string> = new Set<UseCase>([
  "copilot_chat",
  "dictation_command",
]);

/**
 * `meeting_note` covers both kinds of work, so the use case alone cannot decide
 * it. Most of it is unattended and bulk — summarizing a finished meeting,
 * extracting commitments, pulling contacts out of every email thread, pulling
 * conversations out of every meeting. One sub-case is a person typing a
 * question about a meeting and waiting for the answer.
 *
 * Listing the interactive sub-case rather than the background ones is the safe
 * direction: a sub-case added later is paced by default, and the cost of
 * getting that wrong is a queued request rather than an unpaced flood.
 */
const INTERACTIVE_SUB_USE_CASES: ReadonlySet<string> = new Set(["ask"]);

/**
 * Note the coupling, because it is not visible from here: an agent run that
 * does not declare a use case is tagged `copilot_chat` by the runtime
 * (agents/runtime.ts `state.runUseCase ?? "copilot_chat"`), so it reaches this
 * function looking interactive and skips the queue entirely. The `undefined`
 * branch below almost never fires for agent traffic.
 *
 * That default is right for the path it was written for — `runs:create` from
 * the renderer really is someone typing — and every background caller today
 * does declare one (label_emails, tag_notes, build_graph, agent_notes,
 * inline_tasks, live-note, background-tasks, agent-schedule, pre_built; checked
 * all 13 createRun sites). But a new background run that forgets to set
 * `useCase` will not be paced, and nothing will say so: it will simply spend
 * the interactive reserve.
 */
export function isInteractive(useCase: string | undefined, subUseCase?: string): boolean {
  if (useCase === undefined) return false;
  if (INTERACTIVE_USE_CASES.has(useCase)) return true;
  return subUseCase !== undefined && INTERACTIVE_SUB_USE_CASES.has(subUseCase);
}

// The gateway allows 600/min and 100 per 10s per user
// (LLM_RATE_LIMIT_PER_USER_*). Both come to the same 10-per-second ceiling, so
// that is the only number to reason about.
//
// Background takes 7 of those 10 per second — 420/min — leaving ~3/s for
// interactive traffic, which is never queued at all. The reserve is sized off
// what a person can actually generate: a Copilot turn is one agent loop, and 30
// calls in ten seconds is a fast one. Background gets the larger share because
// it is the side with hundreds of calls to make.
//
// Per second rather than per ten. The server's limiter is a fixed window (INCR
// + PEXPIRE in internal/ratelimit/redis.go), not sliding, so its boundary sits
// wherever the first request of a window landed. Releasing a whole window's
// worth at once means two adjacent bursts can fall inside one server window —
// 140 against a cap of 100 — and roughly a third get rejected for no reason but
// phase. Same rate, no burst to straddle a boundary.
//
// Concurrency is capped separately: the limits are per window, but the desktop
// opening dozens of sockets at once helps nobody, and the gateway bounds its
// own outbound fan-out at LLM_MAX_CONCURRENT regardless.
const BACKGROUND_INTERVAL_MS = 1_000;
const BACKGROUND_PER_INTERVAL = 7;
const BACKGROUND_CONCURRENCY = 12;

/**
 * Safety valve against a request that never settles.
 *
 * A stalled socket — laptop sleep with calls in flight, a captive portal, a
 * connection dropped without an RST — leaves fetch pending forever. Nothing
 * else times it out: the desktop passes no abort signal on this path, and the
 * gateway's own response deadline is server-side. Enough of those and the
 * concurrency slots are all held by ghosts and no background work ever runs
 * again until the app restarts. Measured: 12 hangers, zero throughput,
 * permanently.
 *
 * Five minutes is far longer than any real call — for streaming responses fetch
 * settles once headers arrive, so this bounds the wait for a reply to start,
 * not the length of a generation. It exists to break a deadlock, not to enforce
 * latency.
 */
const BACKGROUND_STALL_TIMEOUT_MS = 5 * 60_000;

function newQueue(): PQueue {
  return new PQueue({
    concurrency: BACKGROUND_CONCURRENCY,
    intervalCap: BACKGROUND_PER_INTERVAL,
    interval: BACKGROUND_INTERVAL_MS,
    timeout: BACKGROUND_STALL_TIMEOUT_MS,
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
  // Anything that is not a success and not a rate limit counts.
  //
  // This deliberately includes 4xx. The tempting rule is "only 5xx is a real
  // outage", but the failures that actually strand a desktop are client-side
  // and permanent: 402 when an account runs out of credits, 400 when the
  // configured model is not on the gateway's allowlist, 401 when auth is dead.
  // Every request fails identically, no retry can help, and a breaker that
  // ignores them lets the queue grind through hundreds of doomed calls — the
  // exact thing it exists to stop.
  //
  // 429 is excluded because it means the pacing is working, not that anything
  // is broken. A missing status is a transport failure (offline, DNS, timeout)
  // and counts.
  const rateLimited = status === 429;
  const succeeded = status !== undefined && status >= 200 && status < 300;

  if (succeeded || rateLimited) {
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
export async function throughBackgroundBudget<T extends { status: number }>(
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
