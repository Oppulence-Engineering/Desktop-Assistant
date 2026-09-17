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

vi.mock("@/lib/auth/rowboat-api", () => ({
  refreshWorkOSSession: mocks.refreshWorkOSSession,
  shouldRefreshSession: mocks.shouldRefreshSession,
}));

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

    const result = await getAuthorizedSession(
      new NextRequest("https://oppulence.io/api/rowboat/v1/relationships"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
    expect(mocks.clearAuthCookies).not.toHaveBeenCalled();
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
