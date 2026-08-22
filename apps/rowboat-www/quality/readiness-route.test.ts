import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/readyz/route";

describe("GET /readyz", () => {
  beforeEach(() => {
    vi.stubEnv("ROWBOAT_WWW_API_PROXY_URL", "https://api.example.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports ready when runtime configuration and rowboat-api are healthy", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ready" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toEqual(new URL("https://api.example.test/readyz"));
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports not ready when rowboat-api is unhealthy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
    );

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "not_ready" });
  });

  it("reports not ready without exposing configuration errors", async () => {
    vi.stubEnv("ROWBOAT_WWW_API_PROXY_URL", "not-a-url");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "not_ready" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
