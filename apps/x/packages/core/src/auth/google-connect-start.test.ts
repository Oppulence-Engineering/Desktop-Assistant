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
