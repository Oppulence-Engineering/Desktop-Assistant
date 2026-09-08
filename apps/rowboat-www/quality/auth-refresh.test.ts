import { describe, expect, it, vi } from "vitest";

import { refreshWorkOSSession } from "@/lib/auth/rowboat-api";
import type { DashboardSessionCookie } from "@/lib/auth/schemas";

describe("refreshWorkOSSession", () => {
  it("retries a transient refresh rate limit instead of signing the user out", async () => {
    const expiresAt = Math.floor(Date.now() / 1_000) + 3_600;
    const accessToken = `e30.${Buffer.from(JSON.stringify({ exp: expiresAt })).toString("base64url")}.sig`;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: accessToken,
            expires_at: expiresAt,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    const session: DashboardSessionCookie = {
      version: 1,
      accessToken: "expired",
      refreshToken: "refresh",
      tokenType: "Bearer",
      expiresAt: 1,
      createdAt: 1,
      updatedAt: 1,
      user: { permissions: [] },
    };

    await expect(refreshWorkOSSession(session)).resolves.toMatchObject({ accessToken });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });

  it("coalesces concurrent refreshes of the same session", async () => {
    const expiresAt = Math.floor(Date.now() / 1_000) + 3_600;
    const accessToken = `e30.${Buffer.from(JSON.stringify({ exp: expiresAt })).toString("base64url")}.sig`;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: accessToken,
          expires_at: expiresAt,
          token_type: "Bearer",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const session: DashboardSessionCookie = {
      version: 1,
      accessToken: "expired",
      refreshToken: "concurrent-refresh",
      tokenType: "Bearer",
      expiresAt: 1,
      createdAt: 1,
      updatedAt: 1,
      user: { permissions: [] },
    };

    const [first, second] = await Promise.all([
      refreshWorkOSSession(session),
      refreshWorkOSSession(session),
    ]);

    expect(first?.accessToken).toBe(accessToken);
    expect(second?.accessToken).toBe(accessToken);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });
});
