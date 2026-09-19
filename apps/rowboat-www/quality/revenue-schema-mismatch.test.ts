import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dashboardFetch: vi.fn() }));

vi.mock("@/lib/auth/dashboard-fetch", () => ({
  dashboardRequest: mocks.dashboardFetch,
  toDashboardAPIPath: (path: string) => `/api/rowboat/v1${path}`,
  redirectBrowserIfUnauthorized: () => undefined,
  loginURL: () => "/login",
}));

const respond = (body: unknown) =>
  mocks.dashboardFetch.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

describe("a response that does not match its contract", () => {
  beforeEach(() => {
    mocks.dashboardFetch.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  // The zod issue list used to reach the panel verbatim, so the commitments
  // tab rendered [{"expected":"array","code":"invalid_type",…}] at the user.
  it("never puts the zod issue list in front of the user", async () => {
    const { listCommitments } = await import("@/lib/revenue/revenue");
    respond({});

    const error = await listCommitments().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).not.toContain("{");
    expect(message).not.toContain("invalid_type");
    expect(message).toContain("commitments");
    expect(message).toContain("different versions");
  });

  it("still returns the rows when the contract is met", async () => {
    const { listCommitments } = await import("@/lib/revenue/revenue");
    respond({ commitments: [] });

    await expect(listCommitments()).resolves.toEqual([]);
  });

  it("validates revenue impact before home cards consume it", async () => {
    const { getImpact } = await import("@/lib/revenue/revenue");
    respond({
      approved: 0,
      atRiskRelationships: 1,
      criticalRelationships: 0,
      executed: 0,
      handled: 0,
      longestOverdueDays: 3,
      open: 2,
      overdueByThem: 0,
      overdueByUs: 1,
      overdueCommitments: 1,
      portfolioRiskScore: 25,
      relationships: "not-a-number",
      riskReasons: [],
      surfaced: 2,
    });

    await expect(getImpact()).rejects.toMatchObject({
      code: "schema_mismatch",
    });
  });
});
