import { afterEach, describe, expect, it, vi } from "vitest";

const originalApiUrl = process.env.API_URL;

afterEach(() => {
  if (originalApiUrl === undefined) {
    delete process.env.API_URL;
  } else {
    process.env.API_URL = originalApiUrl;
  }
  vi.resetModules();
});

describe("API_URL", () => {
  it("defaults to the production Rowboat API", async () => {
    delete process.env.API_URL;
    vi.resetModules();

    const { API_URL } = await import("./env.js");

    expect(API_URL).toBe("https://api.oppulence.io");
  });

  it("honors API_URL overrides", async () => {
    process.env.API_URL = "http://localhost:18080";
    vi.resetModules();

    const { API_URL } = await import("./env.js");

    expect(API_URL).toBe("http://localhost:18080");
  });
});
