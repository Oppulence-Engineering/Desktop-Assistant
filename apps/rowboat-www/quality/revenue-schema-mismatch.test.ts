import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dashboardFetch: vi.fn() }));

vi.mock("@/lib/auth/client", () => ({
  dashboardFetch: mocks.dashboardFetch,
  toDashboardAPIPath: (path: string) => `/api/rowboat/v1${path}`,
}));

const respond = (body: unknown) =>
  mocks.dashboardFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });

describe("a response that does not match its contract", () => {
  beforeEach(() => {
    mocks.dashboardFetch.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  // The zod issue list used to reach the panel verbatim, so the commitments
  // tab rendered [{"expected":"array","code":"invalid_type",…}] at the user.
  it("never puts the zod issue list in front of the user", async () => {
    const { listCommitments } = await import("@/lib/revenue");
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
    const { listCommitments } = await import("@/lib/revenue");
    respond({ commitments: [] });

    await expect(listCommitments()).resolves.toEqual([]);
  });
});
