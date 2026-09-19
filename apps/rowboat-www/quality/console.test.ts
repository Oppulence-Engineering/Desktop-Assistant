import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  dashboardFetch: vi.fn(),
  toDashboardAPIPath: vi.fn((path: string) => `/api/rowboat/v1${path}`),
}));

vi.mock("@/lib/auth/client", () => auth);

import {
  ConsoleAPIError,
  getConsolePreferences,
  listConsoleResources,
  patchConsolePreferences,
} from "@/lib/console";

const preferences = {
  defaultAgentSlug: "account-reviewer",
  displayName: "Ada",
  notificationLevel: "off",
  shareUsageData: true,
  showModelReasoning: false,
  theme: "system",
};

describe("validated console adapter", () => {
  beforeEach(() => auth.dashboardFetch.mockReset());

  it("returns only preferences consumed by rowboat-www", async () => {
    auth.dashboardFetch.mockResolvedValue(new Response(JSON.stringify(preferences)));

    await expect(getConsolePreferences()).resolves.toEqual({
      defaultAgentSlug: "account-reviewer",
      displayName: "Ada",
      shareUsageData: true,
    });
  });

  it("sends only supported preference fields", async () => {
    auth.dashboardFetch.mockResolvedValue(new Response(JSON.stringify(preferences)));

    await patchConsolePreferences({ displayName: "Grace", shareUsageData: false });

    const init = auth.dashboardFetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({ displayName: "Grace", shareUsageData: false }));
  });

  it("rejects malformed resource responses", async () => {
    auth.dashboardFetch.mockResolvedValue(
      new Response(JSON.stringify({ limit: 100, offset: 0, resources: [{ id: "invalid" }] })),
    );

    await expect(listConsoleResources("note_template")).rejects.toThrow();
  });

  it("treats a missing console route as an empty resource list", async () => {
    auth.dashboardFetch.mockResolvedValue(
      new Response(JSON.stringify({ code: "not_found", detail: "not found" }), { status: 404 }),
    );

    await expect(listConsoleResources("note_favorite")).resolves.toEqual([]);
  });

  it("exposes stable API errors", async () => {
    auth.dashboardFetch.mockResolvedValue(
      new Response(JSON.stringify({ code: "console_unavailable", detail: "Try later" }), {
        status: 503,
      }),
    );

    await expect(getConsolePreferences()).rejects.toEqual(
      expect.objectContaining<Partial<ConsoleAPIError>>({
        code: "console_unavailable",
        message: "Try later",
        status: 503,
      }),
    );
  });
});
