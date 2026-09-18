import { describe, expect, it } from "vitest";

import { isSessionUsable } from "@/lib/auth/cookies";
import { isPKCECookieFresh, safeReturnTo } from "@/lib/auth/pkce";
import { dashboardProxyHeaders, dashboardProxyPath } from "@/lib/auth/proxy";
import type { DashboardSessionCookie } from "@/lib/auth/schemas";

const session = (expiresAt: number, refreshToken?: string): DashboardSessionCookie => ({
  version: 1,
  accessToken: "access-token",
  refreshToken,
  tokenType: "Bearer",
  expiresAt,
  createdAt: 1_000,
  updatedAt: 1_000,
  user: {
    workosUserId: "workos-user",
    email: "user@example.com",
    permissions: [],
  },
});

describe("authentication and BFF boundaries", () => {
  it("keeps an expired access token authenticated while its session is refreshable", () => {
    expect(isSessionUsable(session(999, "refresh-token"), 1_000)).toBe(true);
    expect(isSessionUsable(session(999), 1_000)).toBe(false);
    expect(isSessionUsable(session(1_001), 1_000)).toBe(true);
  });

  it.each(["https://evil.example/path", "//evil.example/path", "javascript:alert(1)"])(
    "rejects unsafe return target %s",
    (target) => {
      expect(safeReturnTo(target)).toBe("/app");
    },
  );

  it("preserves safe relative paths including query and fragment", () => {
    expect(safeReturnTo("/app/agents?view=active#agent-1")).toBe("/app/agents?view=active#agent-1");
  });

  it("expires stale PKCE state server-side", () => {
    expect(
      isPKCECookieFresh(
        {
          version: 1,
          state: "state",
          codeVerifier: "verifier",
          returnTo: "/app",
          createdAt: 1_000,
        },
        1_000 + 60 * 30 + 1,
      ),
    ).toBe(false);
  });

  it("forces dashboard proxy paths beneath /v1", () => {
    expect(dashboardProxyPath(["agents", "a/b"])).toBe("/v1/agents/a%2Fb");
    expect(dashboardProxyPath(["v1", "me"])).toBe("/v1/me");
    expect(dashboardProxyPath([])).toBe("/v1/me");
  });

  it("rejects path segments that escape the /v1 prefix", () => {
    expect(dashboardProxyPath(["v1", "..", "graphql"])).toBeNull();
    expect(dashboardProxyPath(["..", "admin"])).toBeNull();
    expect(dashboardProxyPath(["v1", "%2e%2e", "graphql"])).toBeNull();
  });

  it("forwards approval credentials but drops arbitrary browser headers", () => {
    const forwarded = dashboardProxyHeaders(
      new Headers({ "X-Approval-Token": "signed", "X-Continuation-Token": "resume", Cookie: "no" }),
    );
    expect(forwarded.get("x-approval-token")).toBe("signed");
    expect(forwarded.get("x-continuation-token")).toBe("resume");
    expect(forwarded.has("cookie")).toBe(false);
  });
});
