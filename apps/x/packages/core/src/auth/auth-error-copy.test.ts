import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthRequestError, getWorkosLoginUrl, exchangeWorkosCode } from "./workos-backend.js";
import { ReconnectRequiredError, TransientRefreshError } from "./refresh-errors.js";

/**
 * Sign-in errors are rendered verbatim in the login panel
 * (`product-login-experience.tsx` puts the string straight into
 * `<AlertDescription>`), so a thrown message is product copy, not a log line.
 *
 * Two properties matter and neither is obvious from reading a single throw
 * site: the message must never name the identity provider, and a retryable
 * outage must read differently from a rejected attempt.
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockStatus(status: number, body: unknown = {}) {
  globalThis.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  })) as unknown as typeof fetch;
}

/** Everything a user could be shown. Nothing here may name the vendor. */
const FORBIDDEN = /workos|authkit|invalid_grant|login-url/i;

describe("sign-in error copy", () => {
  it("does not name the identity provider on a 503", async () => {
    mockStatus(503);
    const err = await getWorkosLoginUrl("http://x", "s", "c").catch((e) => e);
    expect(err).toBeInstanceOf(AuthRequestError);
    // The exact regression: "WorkOS login-url failed: 503".
    expect(err.message).not.toMatch(FORBIDDEN);
    expect(err.message).not.toMatch(/503/);
  });

  it("tells the user a 5xx is worth retrying", async () => {
    mockStatus(503);
    const err = await getWorkosLoginUrl("http://x", "s", "c").catch((e) => e);
    expect(err.message).toMatch(/try again in a moment/i);
  });

  it("says authentication failed for a rejected attempt", async () => {
    mockStatus(401);
    const err = await getWorkosLoginUrl("http://x", "s", "c").catch((e) => e);
    expect(err.message).toMatch(/failed to authenticate/i);
    expect(err.message).not.toMatch(FORBIDDEN);
  });

  it("keeps the technical detail off the message but on the error", async () => {
    mockStatus(503);
    const err = (await getWorkosLoginUrl("http://x", "s", "c").catch((e) => e)) as AuthRequestError;
    // Diagnosability is preserved — it just is not what the user reads.
    expect(err.status).toBe(503);
    expect(err.detail).toMatch(/login-url returned 503/);
  });

  it("does not leak the provider when the network is down", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.oppulence.io");
    }) as unknown as typeof fetch;
    const err = await getWorkosLoginUrl("http://x", "s", "c").catch((e) => e);
    expect(err.message).not.toMatch(FORBIDDEN);
    expect(err.message).toMatch(/check your connection/i);
  });

  it("does not leak the provider from the code exchange", async () => {
    mockStatus(500);
    const err = await exchangeWorkosCode("code", "verifier").catch((e) => e);
    expect(err.message).not.toMatch(FORBIDDEN);
  });

  it("owns the expired-session wording instead of echoing the server", async () => {
    // Even if the server regresses and sends provider-named copy back, the
    // client must not render it.
    mockStatus(409, { reconnectRequired: true, detail: "WorkOS reports invalid_grant; sign in again." });
    const { refreshWorkosTokens } = await import("./workos-backend.js");
    const err = await refreshWorkosTokens("rt").catch((e) => e);
    expect(err).toBeInstanceOf(ReconnectRequiredError);
    expect(err.message).not.toMatch(FORBIDDEN);
    expect(err.message).toMatch(/session expired/i);
  });

  it("classifies a refresh 5xx as transient without naming the provider", async () => {
    mockStatus(503);
    const { refreshWorkosTokens } = await import("./workos-backend.js");
    const err = (await refreshWorkosTokens("rt").catch((e) => e)) as TransientRefreshError;
    expect(err).toBeInstanceOf(TransientRefreshError);
    expect(err.message).not.toMatch(FORBIDDEN);
    expect(err.status).toBe(503);
    expect(err.detail).toMatch(/token refresh returned 503/);
  });
});
