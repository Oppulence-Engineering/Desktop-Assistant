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
  relationshipSourceHealth,
  semanticSearch,
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
    const scan = {
      id: "00000000-0000-4000-8000-000000000001",
      status: "completed",
      mode: "local",
      lookbackDays: 90,
    };
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ scans: [scan] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(listScans()).resolves.toEqual([scan]);
    expect(mockFetch.mock.calls[0]?.[0]).toBe("/revenue-leak-scans?limit=10");
  });
});

describe("semanticSearch", () => {
  it("forwards cancellation and preserves unavailable capability state", async () => {
    const controller = new AbortController();
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ available: false, matches: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(semanticSearch("renewal risk", controller.signal)).resolves.toEqual({
      available: false,
      matches: [],
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/revenue-search?q=renewal+risk",
      expect.objectContaining({ signal: controller.signal }),
    );
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

// Source health is unified across the shell and report. Old account rows can
// remain after OAuth creates a replacement connection, so readiness is true
// when any Google account is healthy rather than false when any row is dead.
it("lets one healthy Google account win over stale dead account rows", () => {
  expect(
    relationshipSourceHealth([
      {
        source: "google",
        status: "reconnect_required",
        missingScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      },
      { source: "google", status: "disconnected", missingScopes: [] },
      { source: "google", status: "live", missingScopes: [] },
    ]),
  ).toBe("ready");
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
