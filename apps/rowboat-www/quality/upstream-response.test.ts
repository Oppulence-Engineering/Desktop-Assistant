import { describe, expect, it } from "vitest";

import { isRecord, streamUpstreamResponse } from "@/lib/bff/upstream-response";

describe("streamUpstreamResponse", () => {
  it("streams upstream bodies with no-store cache control", async () => {
    const upstream = new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
    const response = streamUpstreamResponse(upstream);

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("can pass through upstream cache headers on error responses", () => {
    const upstream = new Response("upstream error", {
      status: 503,
      headers: {
        "Cache-Control": "max-age=60",
        "Content-Type": "application/problem+json",
      },
    });
    const response = streamUpstreamResponse(upstream, {
      cacheControl: "upstream",
      defaultContentType: "application/json; charset=utf-8",
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("max-age=60");
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
  });
});

describe("isRecord", () => {
  it("accepts plain objects only", () => {
    expect(isRecord({ title: "Oppulence API" })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
  });
});
