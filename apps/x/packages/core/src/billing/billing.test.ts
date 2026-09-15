import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * deleteAccount is the desktop's only path to DELETE /v1/me. The API refuses
 * with problem codes (for example workspace_successor_required) that the
 * settings dialog turns into actions, so the code must survive the trip.
 */

const tokens = vi.hoisted(() => ({ getAccessToken: vi.fn() }));
vi.mock("../auth/tokens.js", () => ({ getAccessToken: tokens.getAccessToken }));
vi.mock("../config/env.js", () => ({ API_URL: "https://api.example.test" }));

import { BillingRequestError, deleteAccount } from "./billing.js";

const fetchMock = vi.fn();

function problem(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

beforeEach(() => {
  tokens.getAccessToken.mockReset().mockResolvedValue("access-token-1");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deleteAccount", () => {
  it("sends an authenticated DELETE /v1/me with the confirmation body", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ receiptId: "r1" }), { status: 200 }));
    await deleteAccount();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.test/v1/me");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toEqual({
      Authorization: "Bearer access-token-1",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({ confirm: "DELETE" });
  });

  it.each([200, 202, 204])("resolves for HTTP %i", async (status) => {
    fetchMock.mockResolvedValue(new Response(status === 204 ? null : "{}", { status }));
    await expect(deleteAccount()).resolves.toBeUndefined();
  });

  it.each([
    [400, "confirmation_required"],
    [409, "workspace_successor_required"],
    [429, "rate_limited"],
    [500, "internal_error"],
    [502, "billing_cancellation_failed"],
  ])("rejects HTTP %i with the problem code %s", async (status, code) => {
    fetchMock.mockResolvedValue(problem(status, { code, detail: "ignored" }));
    const error = await deleteAccount().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(BillingRequestError);
    expect(error).toMatchObject({ status, code });
    expect((error as Error).message).toContain(String(status));
    expect((error as Error).message).toContain(code);
  });

  it("carries a null code when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(deleteAccount()).rejects.toMatchObject({ status: 502, code: null });
  });

  it("carries a null code when the problem code is not a string", async () => {
    fetchMock.mockResolvedValue(problem(409, { code: 42 }));
    await expect(deleteAccount()).rejects.toMatchObject({ status: 409, code: null });
  });

  it("does not call the API when no access token is available", async () => {
    const signedOut = new Error("Not signed into Solomon AI");
    tokens.getAccessToken.mockRejectedValue(signedOut);
    await expect(deleteAccount()).rejects.toBe(signedOut);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates a network failure", async () => {
    const offline = new TypeError("fetch failed");
    fetchMock.mockRejectedValue(offline);
    await expect(deleteAccount()).rejects.toBe(offline);
  });
});
