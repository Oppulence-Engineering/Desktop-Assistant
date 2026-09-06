import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dashboardFetch: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}));

vi.mock("@/lib/auth/client", () => ({
  dashboardFetch: mocks.dashboardFetch,
  toDashboardAPIPath: (path: string) => path,
}));

import {
  enrichPendingCompanies,
  enrichPendingPersons,
  safeResearchCitationURL,
} from "@/lib/revenue";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

function requestBody(call: number) {
  const body = mocks.dashboardFetch.mock.calls[call][1]?.body;
  if (typeof body !== "string") throw new Error("expected a JSON request body");
  return JSON.parse(body) as unknown;
}

describe("relationship enrichment client", () => {
  beforeEach(() => mocks.dashboardFetch.mockReset());

  it("batches the confirmed pending set and returns every cited outcome", async () => {
    mocks.dashboardFetch
      .mockResolvedValueOnce(json({ personIds: ["p1", "p2", "p3"] }))
      .mockResolvedValueOnce(
        json({
          outcomes: [
            { personId: "p1", matched: true, written: 4, replayed: false },
            { personId: "p2", matched: false, written: 0, replayed: false },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({ outcomes: [{ personId: "p3", matched: true, written: 3, replayed: false }] }),
      );

    const result = await enrichPendingPersons(2);

    expect(result.requested).toBe(3);
    expect(result.outcomes).toHaveLength(3);
    expect(requestBody(1)).toEqual({
      personIds: ["p1", "p2"],
    });
    expect(requestBody(2)).toEqual({
      personIds: ["p3"],
    });
  });

  it("only exposes web citations as clickable URLs", () => {
    expect(safeResearchCitationURL("https://example.com/profile")).toBe(
      "https://example.com/profile",
    );
    expect(safeResearchCitationURL("javascript:alert(1)")).toBeNull();
    expect(safeResearchCitationURL("not a url")).toBeNull();
  });

  it("batches company enrichment by relationship id", async () => {
    mocks.dashboardFetch
      .mockResolvedValueOnce(json({ relationshipIds: ["r1", "r2"] }))
      .mockResolvedValueOnce(
        json({ outcomes: [{ relationshipId: "r1", matched: true, written: 3, replayed: false }] }),
      )
      .mockResolvedValueOnce(
        json({ outcomes: [{ relationshipId: "r2", matched: false, written: 0, replayed: false }] }),
      );

    const result = await enrichPendingCompanies(1);

    expect(result.requested).toBe(2);
    expect(result.outcomes).toHaveLength(2);
    expect(requestBody(1)).toEqual({ relationshipIds: ["r1"] });
    expect(requestBody(2)).toEqual({ relationshipIds: ["r2"] });
  });
});
