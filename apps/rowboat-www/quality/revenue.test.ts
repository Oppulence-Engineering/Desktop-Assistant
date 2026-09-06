import { beforeEach, describe, expect, it, vi } from "vitest";

import { dashboardFetch } from "@/lib/auth/client";
import {
  companyLinkedInURL,
  friendlyRevenueError,
  getRelationshipGraph,
  interactionCountLabel,
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
  expect(interactionCountLabel(1)).toBe("1 interaction");
  expect(interactionCountLabel(2)).toBe("2 interactions");
});
