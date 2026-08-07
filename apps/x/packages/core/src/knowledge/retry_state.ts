// Shared per-item failure tracking for the knowledge services.
//
// Every one of these services decides what to work on by asking "what isn't
// done yet", and each records only successes. That means an item the agent
// cannot process is re-selected on every poll, forever, at full token cost —
// there is no attempt counter, no backoff, and no point at which anything gives
// up. Observed live in two of them at once: 1,342 emails eligible on every
// 15-second tick (~21,600 credits per sweep against a 10,000/day allowance),
// and the same four notes re-detected as "changed" eight ticks in a row.
//
// Backoff rather than a bare attempt cap, because most failures here are
// transient — an expired bearer, an exhausted balance, a 502 from the vendor.
// Those items should come back; they just should not come back four times a
// minute.

/** One item's failure history. Optional everywhere, so old state files load. */
export interface RetryRecord {
  count: number;
  lastAttemptAt: string;
}

export type RetryMap = Record<string, RetryRecord>;

export const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 5 * 60 * 1000;
const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;

/**
 * Whether `key` may be attempted again.
 *
 * @param key - Item identity (usually an absolute file path).
 * @param failures - The service's failure map, or undefined on a legacy state file.
 * @param now - Injectable clock.
 * @returns false while backing off, and permanently past {@link MAX_ATTEMPTS}.
 */
export function shouldRetry(key: string, failures: RetryMap | undefined, now = Date.now()): boolean {
  const record = failures?.[key];
  if (!record) return true;
  if (record.count >= MAX_ATTEMPTS) return false;
  const wait = Math.min(BACKOFF_BASE_MS * 2 ** (record.count - 1), BACKOFF_CAP_MS);
  return now - new Date(record.lastAttemptAt).getTime() >= wait;
}

/** Record a failed attempt, returning the (possibly newly created) map. */
export function recordFailure(key: string, failures: RetryMap | undefined, now = new Date()): RetryMap {
  const map = failures ?? {};
  map[key] = { count: (map[key]?.count ?? 0) + 1, lastAttemptAt: now.toISOString() };
  return map;
}

/** Forget an item's history — it succeeded, so it is not half-condemned. */
export function clearFailure(key: string, failures: RetryMap | undefined): void {
  delete failures?.[key];
}

/** Items that have exhausted their attempts and are no longer selected. */
export function abandoned(failures: RetryMap | undefined): string[] {
  return Object.entries(failures ?? {})
    .filter(([, record]) => record.count >= MAX_ATTEMPTS)
    .map(([key]) => key);
}
