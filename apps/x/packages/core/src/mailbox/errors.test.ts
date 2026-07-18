import { describe, expect, it } from "vitest";

import {
  classifyProviderError,
  extractRetryAfterMs,
  MailboxProviderError,
  serializeMailboxError,
} from "./errors.js";

const ctx = { provider: "gmail" as const, operation: "getThread", accountId: "acct_1" };

describe("classifyProviderError", () => {
  it("maps 401 to auth_reconnect_required", () => {
    const err = classifyProviderError({ status: 401 }, ctx);
    expect(err.code).toBe("auth_reconnect_required");
    expect(err.needsReconnect).toBe(true);
  });

  it("maps 403 insufficient scope to missing_scope", () => {
    const err = classifyProviderError(
      { status: 403, message: "Insufficient Permission scope" },
      ctx,
    );
    expect(err.code).toBe("missing_scope");
  });

  it("maps generic 403 to auth_reconnect_required", () => {
    const err = classifyProviderError({ status: 403, message: "forbidden" }, ctx);
    expect(err.code).toBe("auth_reconnect_required");
  });

  it("maps 429 to rate limited with a default retry-after", () => {
    const err = classifyProviderError({ status: 429 }, ctx);
    expect(err.code).toBe("provider_rate_limited");
    expect(err.isTransient).toBe(true);
    expect(err.options.retryAfterMs).toBe(30_000);
  });

  it("honors a Retry-After header on 429", () => {
    const err = classifyProviderError(
      { status: 429, response: { headers: { "retry-after": "90" } } },
      ctx,
    );
    expect(err.options.retryAfterMs).toBe(90_000);
  });

  it("maps 5xx to provider_unavailable", () => {
    expect(classifyProviderError({ status: 503 }, ctx).code).toBe("provider_unavailable");
  });

  it("passes through an existing MailboxProviderError unchanged", () => {
    const original = new MailboxProviderError("x", "cursor_invalid", ctx);
    expect(classifyProviderError(original, ctx)).toBe(original);
  });
});

describe("extractRetryAfterMs", () => {
  it("reads seconds from a header", () => {
    expect(extractRetryAfterMs({ response: { headers: { "retry-after": "5" } } })).toBe(5000);
  });
  it("returns undefined when absent", () => {
    expect(extractRetryAfterMs({})).toBeUndefined();
  });
});

describe("serializeMailboxError", () => {
  it("never leaks a stack, only a code and message", () => {
    const shape = serializeMailboxError(classifyProviderError({ status: 429 }, ctx));
    expect(shape.code).toBe("provider_rate_limited");
    expect(Object.keys(shape)).not.toContain("stack");
  });
});
