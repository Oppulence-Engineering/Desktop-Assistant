import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BFF_FETCH_PREFIXES, isBffRequest, resolveRequestUrl } from "@/lib/dev/bff-fetch-log";
import { defaultDevPrefs, getDevPrefs, setDevPrefs } from "@/lib/dev/dev-prefs";
import { personaHandlers } from "@/lib/dev/msw-personas";
import { fullRouteCatalog, productRouteCatalog } from "@/lib/dev/route-catalog";
import { readDevEnvFromProcess } from "@/lib/dev/validate-env";

describe("dev toolkit modules", () => {
  it("detects same-origin BFF paths", () => {
    expect(isBffRequest("/api/rowboat/v1/revenue-actions")).toBe(true);
    expect(isBffRequest("/api/auth/session")).toBe(true);
    expect(isBffRequest("https://oppulence.io/api/support/chat")).toBe(true);
    expect(isBffRequest("/api/changelog")).toBe(false);
    expect(BFF_FETCH_PREFIXES.length).toBeGreaterThan(0);
  });

  it("resolves fetch input URLs", () => {
    expect(resolveRequestUrl("/api/auth/session")).toBe("/api/auth/session");
    expect(resolveRequestUrl(new URL("https://oppulence.io/api/auth/session"))).toBe(
      "https://oppulence.io/api/auth/session",
    );
  });

  it("persists dev prefs when localStorage is available", () => {
    const storage = new Map<string, string>();
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
    });

    setDevPrefs({ ...defaultDevPrefs, mswEnabled: true });
    expect(getDevPrefs().mswEnabled).toBe(true);

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: original,
    });
  });

  it("wires tier 1–4 dev providers and scripts", () => {
    const appProviders = readFileSync(
      new URL("../components/providers/app-providers.tsx", import.meta.url),
      "utf8",
    );
    const queryProvider = readFileSync(
      new URL("../components/providers/query-provider.tsx", import.meta.url),
      "utf8",
    );
    const toolkit = readFileSync(
      new URL("../components/dev/dev-toolkit.tsx", import.meta.url),
      "utf8",
    );
    const pkg = readFileSync(new URL("../package.json", import.meta.url), "utf8");

    expect(appProviders).toContain("DevProviders");
    expect(queryProvider).toContain("QueryDevtoolsPanel");
    expect(toolkit).toContain("ToolsTab");
    expect(toolkit).toContain("LoAF");
    expect(pkg).toContain("dev:doctor");
    expect(pkg).toContain("dev:stack");
    expect(pkg).toContain("test:e2e:smoke");
    expect(
      readFileSync(new URL("../public/mockServiceWorker.js", import.meta.url), "utf8"),
    ).toContain("Mock Service Worker");
  });

  it("validates dev env with dev session secret fallback", () => {
    const report = readDevEnvFromProcess({
      ROWBOAT_WWW_API_PROXY_URL: "http://localhost:18080",
      ROWBOAT_WWW_PUBLIC_API_BASE_URL: "http://localhost:18080",
    });
    expect(report.ok).toBe(true);
    expect(report.warnings.some((warning) => warning.includes("dev session secret"))).toBe(true);
  });

  it("lists product routes with report BFF endpoints", () => {
    const report = productRouteCatalog().find((route) => route.path === "/app/report");
    expect(report?.bffEndpoints).toContain("/api/rowboat/v1/revenue-leak-scans");
    expect(fullRouteCatalog().length).toBeGreaterThan(productRouteCatalog().length);
  });

  it("returns persona handlers for empty workspace", () => {
    expect(personaHandlers("empty-workspace").length).toBeGreaterThan(0);
    expect(personaHandlers("default")).toEqual([]);
  });
});
