import { beforeEach, describe, expect, it, vi } from "vitest";

import { dashboardFetch } from "@/lib/auth/client";
import {
  companyLinkedInURL,
  friendlyRevenueError,
  getRelationshipGraph,
  googleSourceHealth,
  interactionCountLabel,
  latestCompletedScan,
  listScans,
} from "@/lib/revenue";

vi.mock("@/lib/auth/client", () => ({
  dashboardFetch: vi.fn(),
  toDashboardAPIPath: (path: string) => path,
}));

const mockFetch = vi.mocked(dashboardFetch);

beforeEach(() => mockFetch.mockReset());

describe("getRelationshipGraph", () => {
  it("returns an empty portfolio for a legacy API with no relationships", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "invalid relationshipId" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ relationships: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const graph = await getRelationshipGraph({ scope: "portfolio", depth: 1 });

    expect(graph).toMatchObject({ scope: "portfolio", depth: 1, nodes: [], edges: [] });
    expect(mockFetch.mock.calls[1]?.[0]).toBe("/relationships");
  });
});

describe("listScans", () => {
  it("loads server audit history instead of browser-local ids", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ scans: [{ id: "scan-1", status: "completed" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(listScans()).resolves.toEqual([{ id: "scan-1", status: "completed" }]);
    expect(mockFetch.mock.calls[0]?.[0]).toBe("/revenue-leak-scans?limit=10");
  });
});

it("opens the latest report for a stale but authorized Google source", () => {
  expect(
    googleSourceHealth([
      {
        source: "google",
        accounts: [{ status: "stale", missingScopes: [] }],
      },
    ]),
  ).toBe("ready");
  expect(
    latestCompletedScan([
      { id: "failed", status: "failed" },
      { id: "empty-complete", status: "completed", threadsSeen: 0 },
      { id: "latest-complete", status: "completed", threadsSeen: 12 },
      { id: "older-complete", status: "completed", threadsSeen: 8 },
    ])?.id,
  ).toBe("latest-complete");
});

describe("friendlyRevenueError", () => {
  it("turns Gmail rate limits into an actionable message", () => {
    expect(
      friendlyRevenueError(
        "revenue: gmail thread sweep: gmail threads.list: google api returned 429: User-rate limit exceeded",
      ),
    ).toContain("try the audit again in about 15 minutes");
  });
});

describe("companyLinkedInURL", () => {
  it("uses an exact company reference and otherwise falls back to LinkedIn search", () => {
    expect(companyLinkedInURL("Solomon AI", [])).toContain("keywords=Solomon%20AI");
    expect(companyLinkedInURL("Solomon AI", ["linkedin:company:solomon-ai"])).toBe(
      "https://www.linkedin.com/company/solomon-ai",
    );
    expect(
      companyLinkedInURL("Solomon AI", [], "https://www.linkedin.com/company/solomon-ai-inc"),
    ).toBe("https://www.linkedin.com/company/solomon-ai-inc");
  });
});

it("labels interaction counts grammatically", () => {
  expect(interactionCountLabel(1)).toBe("1 email thread");
  expect(interactionCountLabel(2)).toBe("2 email threads");
});

// An absent count is not a count of zero. An account last touched eighteen
// hours ago was labelled "0 interactions" because the total had never been
// computed — a number nobody counted, stated as fact.
it("interactionCountLabel does not invent a zero", () => {
  expect(interactionCountLabel(undefined)).toBe("—");
  expect(interactionCountLabel(null)).toBe("—");
  expect(interactionCountLabel(0)).toBe("0 email threads");
});
