/**
 * Provider error normalization.
 *
 * Every provider adapter throws {@link MailboxProviderError} so the sync
 * controller, action runner, and UI can reason about failures uniformly:
 * distinguish "needs reconnect" from "rate limited" from "transient 5xx",
 * respect a provider-supplied Retry-After, and never surface a raw provider
 * stack trace or an email body in a log line.
 */

import type { MailboxErrorCode, MailboxErrorShape, MailboxProviderKind } from "./types.js";

export type MailboxProviderErrorOptions = {
  provider: MailboxProviderKind;
  operation: string;
  accountId: string;
  retryAfterMs?: number;
  status?: number;
  cause?: unknown;
};

export class MailboxProviderError extends Error {
  readonly code: MailboxErrorCode;
  readonly options: MailboxProviderErrorOptions;

  constructor(message: string, code: MailboxErrorCode, options: MailboxProviderErrorOptions) {
    super(message);
    this.name = "MailboxProviderError";
    this.code = code;
    this.options = options;
  }

  /** True when retrying the same call soon could plausibly succeed. */
  get isTransient(): boolean {
    return this.code === "provider_rate_limited" || this.code === "provider_unavailable";
  }

  /** True when the user must re-authorize before this account can be used again. */
  get needsReconnect(): boolean {
    return this.code === "auth_reconnect_required" || this.code === "missing_scope";
  }

  toShape(): MailboxErrorShape {
    return {
      code: this.code,
      message: this.message,
      operation: this.options.operation,
      retryAt:
        this.options.retryAfterMs !== undefined
          ? Date.now() + this.options.retryAfterMs
          : undefined,
      providerStatus: this.options.status,
    };
  }
}

/** A policy engine refused to run an action. Distinct from a provider failure. */
export class MailboxPolicyError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "MailboxPolicyError";
    this.reason = reason;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Best-effort HTTP status extraction across the shapes different provider SDKs
 * throw: `error.status`, `error.code`, `error.response.status`, and the
 * googleapis `GaxiosError` shape.
 */
export function extractHttpStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;

  const direct = error.status ?? error.statusCode ?? error.code;
  if (typeof direct === "number") return direct;

  const response = error.response;
  if (isRecord(response) && typeof response.status === "number") {
    return response.status;
  }

  return undefined;
}

/**
 * Extracts a Retry-After hint (in ms) from a provider error. Handles both the
 * seconds-based `Retry-After` header and provider-specific millisecond fields.
 */
export function extractRetryAfterMs(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;

  const response = error.response;
  const headers = isRecord(response) ? response.headers : undefined;

  if (isRecord(headers)) {
    const raw = headers["retry-after"] ?? headers["Retry-After"];
    if (typeof raw === "string" || typeof raw === "number") {
      const seconds = Number(raw);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
    }
  }

  if (typeof error.retryAfterMs === "number") return error.retryAfterMs;
  return undefined;
}

/** True when a Gmail/Google error body indicates an insufficient-scope failure. */
function isMissingScopeError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  if (message.includes("insufficient") && message.includes("scope")) return true;
  if (message.includes("insufficientpermissions")) return true;
  const errors = isRecord(error.response)
    ? (error.response as Record<string, unknown>).data
    : undefined;
  return typeof errors === "string" && errors.toLowerCase().includes("insufficient");
}

/**
 * Maps an arbitrary thrown value from a provider call into a
 * {@link MailboxProviderError} with a stable code. If the value is already a
 * MailboxProviderError it is returned unchanged.
 */
export function classifyProviderError(
  error: unknown,
  context: { provider: MailboxProviderKind; operation: string; accountId: string },
): MailboxProviderError {
  if (error instanceof MailboxProviderError) return error;

  const status = extractHttpStatus(error);
  const retryAfterMs = extractRetryAfterMs(error);

  if (status === 401) {
    return new MailboxProviderError("Mailbox account needs reconnect", "auth_reconnect_required", {
      ...context,
      status,
      cause: error,
    });
  }

  if (status === 403) {
    if (isMissingScopeError(error)) {
      return new MailboxProviderError(
        "Mailbox account is missing a required scope",
        "missing_scope",
        {
          ...context,
          status,
          cause: error,
        },
      );
    }
    return new MailboxProviderError("Mailbox account needs reconnect", "auth_reconnect_required", {
      ...context,
      status,
      cause: error,
    });
  }

  if (status === 404) {
    return new MailboxProviderError("Mailbox resource not found", "not_found", {
      ...context,
      status,
      cause: error,
    });
  }

  if (status === 429) {
    return new MailboxProviderError(
      "Mailbox provider rate limited this account",
      "provider_rate_limited",
      {
        ...context,
        status,
        retryAfterMs: retryAfterMs ?? 30_000,
        cause: error,
      },
    );
  }

  if (status && status >= 500) {
    return new MailboxProviderError(
      "Mailbox provider is temporarily unavailable",
      "provider_unavailable",
      {
        ...context,
        status,
        retryAfterMs: retryAfterMs ?? 15_000,
        cause: error,
      },
    );
  }

  return new MailboxProviderError("Mailbox provider operation failed", "unknown", {
    ...context,
    status,
    cause: error,
  });
}

/** Serializes any error into the redaction-safe {@link MailboxErrorShape}. */
export function serializeMailboxError(error: unknown): MailboxErrorShape {
  if (error instanceof MailboxProviderError) return error.toShape();
  if (error instanceof Error) {
    return { code: "unknown", message: error.message };
  }
  return { code: "unknown", message: String(error) };
}
