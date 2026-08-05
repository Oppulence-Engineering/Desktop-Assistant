/**
 * Shared error taxonomy for token-refresh flows (WorkOS broker + Google/Slack
 * backend refresh). Callers branch on these classes instead of string-matching
 * messages:
 *
 *   ReconnectRequiredError — the upstream reported the grant is dead
 *     (`invalid_grant` / reconnectRequired). Only a full re-auth fixes it.
 *   TransientRefreshError  — rate limit, in-flight dedup, upstream 5xx or
 *     network failure. Stored tokens must be left untouched; retry later.
 *   AuthUnavailableError   — thrown by getAccessToken() when no usable token
 *     can be produced *right now* without a (pointless) network call. Carries
 *     the reason so background subsystems can quiesce instead of hammering.
 */

/** Thrown when the api signals the user must reconnect (`invalid_grant`). */
export class ReconnectRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconnectRequiredError";
  }
}

/**
 * Thrown when the api signals a transient failure (rate limit, in-flight dedup,
 * upstream 5xx, network) — caller should leave stored tokens untouched and
 * retry later rather than flagging the user for reconnect.
 */
export class TransientRefreshError extends Error {
  readonly status: number;
  /** Parsed Retry-After in milliseconds, when the response carried one. */
  readonly retryAfterMs?: number;
  /**
   * Technical context for logs — provider names, endpoints, upstream text.
   *
   * Deliberately separate from `message`, which can surface in the UI. Keeping
   * them apart is what lets the message stay human without losing the detail an
   * on-call engineer needs.
   */
  readonly detail?: string;
  constructor(message: string, status: number, retryAfterMs?: number, detail?: string) {
    super(message);
    this.name = "TransientRefreshError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.detail = detail;
  }
}

export type AuthUnavailableReason = "not_signed_in" | "reconnect_required" | "refresh_backoff";

/**
 * Thrown by getAccessToken() when auth is currently unavailable and no network
 * call was (or should be) made. `retryAt` is set for `refresh_backoff` —
 * epoch ms when the next refresh attempt is allowed.
 */
export class AuthUnavailableError extends Error {
  readonly reason: AuthUnavailableReason;
  readonly retryAt?: number;
  constructor(reason: AuthUnavailableReason, message: string, retryAt?: number) {
    super(message);
    this.name = "AuthUnavailableError";
    this.reason = reason;
    this.retryAt = retryAt;
  }
}

/** Parse a Retry-After header (delta-seconds form) into ms; undefined if absent/garbage. */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (!Number.isFinite(secs) || secs < 0) return undefined;
  return Math.round(secs * 1000);
}
