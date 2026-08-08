import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Managed Google connect starts by asking the api where to send the browser.
 *
 * It used to open `<webapp>/oauth/google/start` — a route the webapp has never
 * served since the flow moved to the api. The browser landed on a 404 while the
 * desktop reported success, so the app claimed to have started a connect that
 * never began. The url must come from the api, and a failure to obtain one must
 * be a failure, not a cheerful no-op.
 */

vi.mock("./tokens.js", () => ({
  getAccessToken: vi.fn(async () => "test-bearer"),
}));

// The https guard has one carve-out keyed on where this app points, so the
// tests need to drive API_URL.
const api = vi.hoisted(() => ({ url: "https://api.oppulence.io" }));
vi.mock("../config/env.js", async (io) => ({
  ...(await io<typeof import("../config/env.js")>()),
  get API_URL() {
    return api.url;
  },
}));

const originalFetch = globalThis.fetch;
let calls: Array<{ url: string; method?: string; auth?: string }>;

function mockResponse(status: number, body: unknown) {
  calls = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method,
      auth: (init?.headers as Record<string, string> | undefined)?.authorization,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=abc";

describe("startGoogleConnectViaBackend", () => {
  it("asks the api for the authorize url and returns it", async () => {
    mockResponse(200, { authorizeUrl: AUTHORIZE });
    const { startGoogleConnectViaBackend } = await import("./google-backend-oauth.js");
    const url = await startGoogleConnectViaBackend();

    expect(url).toBe(AUTHORIZE);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].auth).toBe("Bearer test-bearer");
  });

  it("hits the api start endpoint, never the webapp path that 404s", async () => {
    mockResponse(200, { authorizeUrl: AUTHORIZE });
    const { startGoogleConnectViaBackend } = await import("./google-backend-oauth.js");
    await startGoogleConnectViaBackend();

    // The exact regression: GET <webapp>/oauth/google/start.
    expect(calls[0].url).not.toMatch(/\/oauth\/google\/start/);
    expect(calls[0].url).toContain("/v1/google-oauth/start");
  });

  it("tells an unauthenticated user to sign in first", async () => {
    mockResponse(401, { error: "unauthenticated" });
    const { startGoogleConnectViaBackend } = await import("./google-backend-oauth.js");
    await expect(startGoogleConnectViaBackend()).rejects.toThrow(/sign in/i);
  });

  it("fails instead of returning nothing when the api omits the url", async () => {
    // A success status with a missing field is how the old bug felt from the
    // outside: everything reported fine and nothing happened.
    mockResponse(200, {});
    const { startGoogleConnectViaBackend } = await import("./google-backend-oauth.js");
    await expect(startGoogleConnectViaBackend()).rejects.toThrow(/no authorize URL/i);
  });

  it("refuses to hand a non-https url to the OS opener", async () => {
    mockResponse(200, { authorizeUrl: "file:///etc/passwd" });
    const { startGoogleConnectViaBackend } = await import("./google-backend-oauth.js");
    await expect(startGoogleConnectViaBackend()).rejects.toThrow(/non-https/i);
  });

  it("refuses a malformed url", async () => {
    mockResponse(200, { authorizeUrl: "not a url" });
    const { startGoogleConnectViaBackend } = await import("./google-backend-oauth.js");
    await expect(startGoogleConnectViaBackend()).rejects.toThrow(/malformed/i);
  });

  it("surfaces a server failure rather than reporting a started connect", async () => {
    mockResponse(502, { error: "google not configured" });
    const { startGoogleConnectViaBackend } = await import("./google-backend-oauth.js");
    await expect(startGoogleConnectViaBackend()).rejects.toThrow(/Couldn't start Google setup/i);
  });
});

/**
 * The authorize URL goes straight to the system browser, so an api that is
 * hostile or MITM'd could otherwise aim the OS at anything. https is the rule.
 *
 * The single carve-out is plain http on loopback while this app is itself
 * pointed at a loopback http api — the shape of the local kind stack, which
 * mocks Google's authorize endpoint on http://localhost:18090. Without it that
 * mock is unreachable and the failure reads "refusing to open a non-https URL",
 * which sounds like an app bug rather than a property of the dev stack.
 */
describe("authorize url scheme guard", () => {
  afterEach(() => {
    api.url = "https://api.oppulence.io";
  });

  it("allows the local stack's http loopback mock when pointed at a local api", async () => {
    api.url = "http://localhost:18081";
    mockResponse(200, { authorizeUrl: "http://localhost:18090/o/oauth2/v2/auth?client_id=x" });
    const { startGoogleConnectViaBackend } = await import("./google-backend-oauth.js");
    await expect(startGoogleConnectViaBackend()).resolves.toContain("http://localhost:18090/");
  });

  // The half that keeps the carve-out honest: a production api must never be
  // able to point the browser at a service on the user's own machine.
  it("still refuses an http loopback url when pointed at the production api", async () => {
    api.url = "https://api.oppulence.io";
    mockResponse(200, { authorizeUrl: "http://localhost:18090/o/oauth2/v2/auth" });
    const { startGoogleConnectViaBackend } = await import("./google-backend-oauth.js");
    await expect(startGoogleConnectViaBackend()).rejects.toThrow(/non-https/i);
  });

  it("refuses non-loopback http even against a local api", async () => {
    api.url = "http://localhost:18081";
    mockResponse(200, { authorizeUrl: "http://evil.example.com/o/oauth2/v2/auth" });
    const { startGoogleConnectViaBackend } = await import("./google-backend-oauth.js");
    await expect(startGoogleConnectViaBackend()).rejects.toThrow(/non-https/i);
  });

  it("refuses a non-http scheme even against a local api", async () => {
    api.url = "http://localhost:18081";
    mockResponse(200, { authorizeUrl: "file:///etc/passwd" });
    const { startGoogleConnectViaBackend } = await import("./google-backend-oauth.js");
    await expect(startGoogleConnectViaBackend()).rejects.toThrow(/non-https/i);
  });

  it("still allows https against a local api", async () => {
    api.url = "http://localhost:18081";
    mockResponse(200, { authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth" });
    const { startGoogleConnectViaBackend } = await import("./google-backend-oauth.js");
    await expect(startGoogleConnectViaBackend()).resolves.toContain("https://accounts.google.com/");
  });
});

/**
 * A claim can land before the browser half has finished — the desktop polls for
 * the tokens because the deep link cannot be relied on to arrive.
 *
 * Older api builds answered that early claim with 200 and a zero-valued bundle.
 * Storing it produced a connection whose access token was the empty string,
 * which failed on first use as "Missing refresh token. Please reconnect." — a
 * dead end indistinguishable from a genuine authorization failure, and by then
 * the one-shot ticket was gone, so the real callback failed too.
 *
 * The api now returns 409 not_ready. This pins the client half, which has to
 * hold against an api that has not been upgraded yet.
 */
describe("claimTokensViaBackend", () => {
  it("rejects an empty bundle returned as 200", async () => {
    mockResponse(200, { access_token: "", expires_at: 0 });
    const { claimTokensViaBackend } = await import("./google-backend-oauth.js");
    await expect(claimTokensViaBackend("state-1")).rejects.toThrow(/not complete yet/i);
  });

  it("rejects a 409 not_ready", async () => {
    mockResponse(409, { error: "authorization is not complete yet", code: "not_ready" });
    const { claimTokensViaBackend } = await import("./google-backend-oauth.js");
    await expect(claimTokensViaBackend("state-1")).rejects.toThrow(/claim failed/i);
  });

  it("returns the tokens once the callback has parked them", async () => {
    mockResponse(200, {
      access_token: "ya29.real",
      refresh_token: "1//refresh",
      expires_at: 1786134880,
      scope: "openid https://www.googleapis.com/auth/gmail.readonly",
    });
    const { claimTokensViaBackend } = await import("./google-backend-oauth.js");
    const tokens = await claimTokensViaBackend("state-1");

    expect(tokens.access_token).toBe("ya29.real");
    expect(tokens.refresh_token).toBe("1//refresh");
    expect(tokens.scopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
  });
});
