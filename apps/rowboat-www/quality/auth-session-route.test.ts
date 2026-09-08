import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { DashboardSessionCookie } from "@/lib/auth/schemas";

const mocks = vi.hoisted(() => ({
  clearAuthCookies: vi.fn(),
  fetchViewer: vi.fn(),
  fetchViewerIdentity: vi.fn(),
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
  fetchViewer: mocks.fetchViewer,
  fetchViewerIdentity: mocks.fetchViewerIdentity,
  refreshWorkOSSession: mocks.refreshWorkOSSession,
  shouldRefreshSession: mocks.shouldRefreshSession,
}));

import { GET } from "@/app/api/auth/session/route";

const session: DashboardSessionCookie = {
  version: 1,
  accessToken: "access-token",
  tokenType: "Bearer",
  expiresAt: 2_000_000_000,
  createdAt: 1_999_999_000,
  updatedAt: 1_999_999_000,
  user: {
    workosUserId: "workos-user",
    email: "user@example.com",
    organizationId: "org-1",
    permissions: [],
  },
};

describe("browser session route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSessionCookie.mockReturnValue(session);
    mocks.shouldRefreshSession.mockReturnValue(false);
  });

  it("keeps a valid sealed session usable when viewer billing is unavailable", async () => {
    mocks.fetchViewer.mockRejectedValue(new Error("could not load billing"));
    mocks.fetchViewerIdentity.mockResolvedValue({
      user: { id: "local-user", email: "verified@example.com" },
    });

    const response = await GET(new NextRequest("https://oppulence.io/api/auth/session"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      authenticated: true,
      user: {
        id: "local-user",
        workosUserId: "workos-user",
        email: "verified@example.com",
        organizationId: "org-1",
      },
      expiresAt: session.expiresAt,
    });
  });

  it("keeps the cookie when a refresh service is temporarily unavailable", async () => {
    mocks.shouldRefreshSession.mockReturnValue(true);
    mocks.refreshWorkOSSession.mockRejectedValue(new Error("rate limited"));

    const response = await GET(new NextRequest("https://oppulence.io/api/auth/session"));

    expect(response.status).toBe(503);
    expect(mocks.clearAuthCookies).not.toHaveBeenCalled();
  });
});
