import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  clearAuthCookies: vi.fn(),
  readSessionCookie: vi.fn(),
  refreshWorkOSSession: vi.fn(),
  shouldRefreshSession: vi.fn(),
}));

vi.mock("@/lib/auth/cookies", () => ({
  clearAuthCookies: mocks.clearAuthCookies,
  readSessionCookie: mocks.readSessionCookie,
  setSessionCookie: vi.fn(),
}));

vi.mock("@/lib/auth/rowboat-api", () => ({
  refreshWorkOSSession: mocks.refreshWorkOSSession,
  shouldRefreshSession: mocks.shouldRefreshSession,
}));

import { getAuthorizedSession } from "@/lib/auth/proxy";

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
