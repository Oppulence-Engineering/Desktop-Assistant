import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/plan-response/route";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("plan response route", () => {
  it("rejects oversized bodies before calling upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new NextRequest("https://oppulence.io/api/plan-response", {
        method: "POST",
        body: "a".repeat(300_000),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats null response payloads as a plan fetch, not a submit", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const token = "a".repeat(64);
    const response = await POST(
      new NextRequest("https://oppulence.io/api/plan-response", {
        method: "POST",
        body: JSON.stringify({ token, response: null }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const upstreamURL = fetchMock.mock.calls[0]?.[0];
    expect(String(upstreamURL)).toContain("/v1/public/mutual-action-plan");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBe("GET");
  });
});
