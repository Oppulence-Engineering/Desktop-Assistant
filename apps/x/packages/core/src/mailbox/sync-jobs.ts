/**
 * Sync backoff math.
 *
 * Pure, deterministic (given `now` and an injected `random`) so the reliability
 * behavior — never hammer a provider after a 429/5xx, always respect a
 * provider-supplied Retry-After — can be unit tested with fake timers.
 */

export type ComputeBackoffInput = {
  attempt: number;
  retryAfterMs?: number;
  now: number;
  maxBackoffMs?: number;
  /** Injectable for tests; defaults to Math.random. */
  random?: () => number;
};

const DEFAULT_MAX_BACKOFF_MS = 15 * 60_000;
const BASE_MS = 5_000;

/**
 * Exponential backoff with jitter, floored by any provider Retry-After. Returns
 * an absolute timestamp (ms) at which the next attempt is allowed.
 */
export function computeMailboxBackoff(input: ComputeBackoffInput): number {
  const random = input.random ?? Math.random;
  const max = input.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const base = Math.min(BASE_MS * 2 ** Math.max(0, input.attempt), max);
  const jitter = Math.floor(random() * Math.min(base * 0.2, 30_000));
  const providerFloor = input.retryAfterMs ?? 0;
  return input.now + Math.max(base + jitter, providerFloor);
}

export type MailboxJobType =
  | "initial_backfill"
  | "incremental_sync"
  | "repair"
  | "watch_renewal"
  | "provider_action";

export type MailboxJobStatus =
  | "queued"
  | "running"
  | "backoff"
  | "succeeded"
  | "failed"
  | "cancelled";

export type MailboxJob = {
  id: string;
  accountId: string;
  type: MailboxJobType;
  status: MailboxJobStatus;
  dedupeKey: string;
  attempt: number;
  availableAt: number;
  lockedUntil?: number;
  payload: Record<string, unknown>;
};
