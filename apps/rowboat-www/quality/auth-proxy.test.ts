import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  clearAuthCookies: vi.fn(),
  readSessionCookie: vi.fn(),
  refreshWorkOSSession: vi.fn(),
  setSessionCookie: vi.fn(),
  shouldRefreshSession: vi.fn(),
}));

vi.mock("@/lib/auth/cookies", () => ({
  clearAuthCookies: mocks.clearAuthCookies,
  readSessionCookie: mocks.readSessionCookie,
  setSessionCookie: mocks.setSessionCookie,
}));

vi.mock("@/lib/auth/rowboat-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/rowboat-api")>();
  return {
    ...actual,
    refreshWorkOSSession: mocks.refreshWorkOSSession,
    shouldRefreshSession: mocks.shouldRefreshSession,
  };
});

import { applyAuthorizedSessionCookies, getAuthorizedSession } from "@/lib/auth/proxy";
import type { DashboardSessionCookie } from "@/lib/auth/schemas";

describe("dashboard proxy session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSessionCookie.mockReturnValue({ refreshToken: "refresh" });
    mocks.shouldRefreshSession.mockReturnValue(true);
  });

  it("keeps the cookie when refresh is temporarily unavailable", async () => {
    mocks.refreshWorkOSSession.mockRejectedValue(new Error("rate limited"));
    mocks.readSessionCookie.mockReturnValue({
      refreshToken: "refresh",
      expiresAt: Math.floor(Date.now() / 1_000) - 1,
    });

    const result = await getAuthorizedSession(
      new NextRequest("https://oppulence.io/api/rowboat/v1/relationships"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
    expect(mocks.clearAuthCookies).not.toHaveBeenCalled();
  });

  it("continues with the current access token when refresh is down but still valid", async () => {
    mocks.refreshWorkOSSession.mockRejectedValue(new Error("upstream unavailable"));
    mocks.readSessionCookie.mockReturnValue({
      refreshToken: "refresh",
      accessToken: "still-valid",
      expiresAt: Math.floor(Date.now() / 1_000) + 900,
    });

    const result = await getAuthorizedSession(
      new NextRequest("https://oppulence.io/api/rowboat/v1/agents"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.accessToken).toBe("still-valid");
    expect(mocks.clearAuthCookies).not.toHaveBeenCalled();
  });

  it("clears auth when refresh requires reconnect", async () => {
    mocks.refreshWorkOSSession.mockResolvedValue(null);

    const result = await getAuthorizedSession(
      new NextRequest("https://oppulence.io/api/rowboat/v1/agents"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    expect(mocks.clearAuthCookies).toHaveBeenCalledTimes(1);
  });
});

describe("applyAuthorizedSessionCookies", () => {
  const refreshed = { accessToken: "new-token" } as DashboardSessionCookie;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears auth cookies when upstream returns 401", () => {
    const response = NextResponse.json({ ok: true });
    applyAuthorizedSessionCookies(response, { ok: true, session: refreshed, refreshed }, 401);

    expect(mocks.clearAuthCookies).toHaveBeenCalledWith(response);
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
  });

  it("re-seals refreshed sessions when upstream succeeds", () => {
    const response = NextResponse.json({ ok: true });
    applyAuthorizedSessionCookies(response, { ok: true, session: refreshed, refreshed }, 200);

    expect(mocks.setSessionCookie).toHaveBeenCalledWith(response, refreshed);
    expect(mocks.clearAuthCookies).not.toHaveBeenCalled();
  });
});
