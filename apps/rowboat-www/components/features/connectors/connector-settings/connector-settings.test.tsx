// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQuery } from "@/quality/test-support/render-query";

import type { Connector } from "@/lib/api/generated/client/model";
import { fetchRelationshipSourceStatuses } from "@/hooks/queries/utils/fetch-relationship-sources";
import type { RelationshipSourceStatus } from "@/lib/revenue/types";

import { ConnectorSettings } from "./connector-settings";

const { fetchRelationshipSourceStatusesMock } = vi.hoisted(() => ({
  fetchRelationshipSourceStatusesMock: vi.fn(async () => [] as RelationshipSourceStatus[]),
}));

vi.mock("@/hooks/queries/utils/fetch-relationship-sources", () => ({
  fetchRelationshipSourceStatuses: fetchRelationshipSourceStatusesMock,
  fetchRelationshipSources: vi.fn(async () => []),
}));

const requiredScope = {
  description: "Read relationship email evidence.",
  displayName: "Read email evidence",
  grantTier: "required" as const,
  name: "google:email.read",
  risk: "low" as const,
};

const optionalScope = {
  description: "Create draft replies after approval.",
  displayName: "Create drafts",
  grantTier: "optional" as const,
  name: "google:drafts.write",
  risk: "medium" as const,
};

function connector(overrides: Partial<Connector> = {}): Connector {
  return {
    audience: "google-product-api",
    authType: "oauth",
    availableScopes: [requiredScope, optionalScope],
    connected: false,
    connectionHealth: "disconnected",
    description: "Google mail and calendar evidence.",
    displayName: "Google",
    health: "healthy",
    mcpUrl: "https://connectors.example/google",
    name: "google",
    status: "enabled",
    ...overrides,
  };
}

function mockConnectors(...connectors: Connector[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    void _init;
    const url = String(input);
    if (url.includes("/api/rowboat/v1/google-oauth")) {
      return new Response(JSON.stringify({ connected: false, accounts: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/relationship-sources/status")) {
      return new Response(JSON.stringify({ sources: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/composio/")) {
      return new Response(JSON.stringify({ toolkits: [], connections: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/connectors/")) {
      return new Response(JSON.stringify({ outcome: "retry" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ connectors }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  fetchRelationshipSourceStatusesMock.mockReset();
  fetchRelationshipSourceStatusesMock.mockResolvedValue([]);
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/app/settings?settings=connections");
});

describe("hosted connector settings", () => {
  it("explains stale sync without presenting reauthorization as the normal action", async () => {
    vi.mocked(fetchRelationshipSourceStatuses).mockResolvedValue([
      { source: "google", status: "stale" } as RelationshipSourceStatus,
    ]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const url = String(input);
      const body = url.includes("/api/rowboat/v1/google-oauth")
        ? {
            connected: true,
            accounts: [
              {
                accountId: "owner@example.com",
                connectedAt: "2026-09-09T12:00:00Z",
                scopes: [],
              },
            ],
          }
        : { connectors: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const confirm = vi.fn(() => false);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirm);

    renderWithQuery(<ConnectorSettings />);

    const changeAccess = await screen.findByRole("button", { name: "Change Google access" });
    expect(screen.getByText(/Source data is delayed; reauthorizing is not required/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Reconnect Google" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reauthorize Google" })).not.toBeInTheDocument();
    await userEvent.click(changeAccess);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("does not refresh delayed data"));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("starts from the actual Connect control with explicit required scopes", async () => {
    const fetchMock = mockConnectors(connector());
    renderWithQuery(<ConnectorSettings />);

    const row = await screen.findByTestId("connector-google");
    const connect = within(row).getByRole("button", { name: "Connect Google" });
    const form = connect.closest("form");
    expect(form).toHaveAttribute("action", "/api/connectors/google/start");
    expect(form).toHaveAttribute("method", "post");

    await userEvent.click(connect);

    const startCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/api/connectors/"),
    );
    expect(startCall?.[0]).toBe("http://localhost:3000/api/connectors/google/start");
    expect(startCall?.[1]).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect((startCall?.[1]?.body as FormData).getAll("requested_scope")).toEqual([
      "google:email.read",
    ]);
  });

  it("submits selected optional scopes while retaining required permissions", async () => {
    const fetchMock = mockConnectors(connector());
    renderWithQuery(<ConnectorSettings />);

    const row = await screen.findByTestId("connector-google");
    await userEvent.click(within(row).getByText("Permissions"));
    await userEvent.click(within(row).getByRole("checkbox"));
    const authorize = within(row).getByRole("button", {
      name: "Authorize Google with selected permissions",
    });
    await userEvent.click(authorize);

    const startCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/api/connectors/"),
    );
    expect((startCall?.[1]?.body as FormData).getAll("requested_scope")).toEqual([
      "google:email.read",
      "google:drafts.write",
    ]);
  });

  it("safely disables hosted OAuth when the connector cannot support it", async () => {
    mockConnectors(
      connector({
        connectionHealth: "disabled",
        connectionReason: "provider_configuration_missing",
        health: "unavailable",
      }),
    );
    renderWithQuery(<ConnectorSettings />);

    const row = await screen.findByTestId("connector-google");
    expect(within(row).getByRole("button", { name: "Connect Google" })).toBeDisabled();
    expect(within(row).getByText("provider_configuration_missing")).toBeVisible();
  });

  it("shows the claimed active lifecycle and health without retaining callback state", async () => {
    window.history.replaceState(
      null,
      "",
      "/app/settings?settings=connections&connector_oauth=active&connector=google",
    );
    mockConnectors(
      connector({
        connected: true,
        connectedAt: "2026-08-28T01:00:00Z",
        connectionHealth: "healthy",
        grantedScopes: [requiredScope],
      }),
    );
    renderWithQuery(<ConnectorSettings />);

    expect(
      await screen.findByText(/Authorization was claimed and the connection is active/),
    ).toBeVisible();
    const row = await screen.findByTestId("connector-google");
    expect(within(row).getByText("Active")).toBeVisible();
    expect(within(row).getByText("Healthy")).toBeVisible();
    expect(within(row).getByText(/Granted scopes: google:email.read/)).toBeVisible();
    expect(window.location.search).toBe("?settings=connections");
  });
});

describe("Google grant claimed in the web app", () => {
  function mockDashboard(options: { connectors?: Connector[]; toolkits?: unknown[] } = {}) {
    const calls: string[] = [];
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(
          `${init?.method ?? "GET"} ${url} ${typeof init?.body === "string" ? init.body : ""}`,
        );
        if (url.includes("/google-oauth/claim")) return json({});
        if (url.includes("/google-oauth/start")) {
          return json({ authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=s1" });
        }
        if (url.includes("/google-oauth")) {
          return json({
            connected: true,
            accounts: [
              {
                accountId: "me@x.co",
                scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
                connectedAt: "2026-09-16T00:00:00Z",
              },
            ],
          });
        }
        if (url.includes("/relationship-sources/google/authorization")) {
          return json({ source: "google", status: "connected" });
        }
        if (url.includes("/relationship-sources/status")) return json({ sources: [] });
        if (url.includes("/composio/toolkits")) return json({ toolkits: options.toolkits ?? [] });
        if (url.includes("/composio/connections")) return json({ connections: [] });
        return json({ connectors: options.connectors ?? [] });
      }),
    );
    return calls;
  }

  // The reported bug: a reconnect started on this page came back to the desktop
  // app's deep link, so nothing here claimed the grant and the dead grant stayed
  // dead. The start call names the web flow so the callback returns here.
  it("starts Google authorization as a web flow", async () => {
    const calls = mockDashboard();
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    renderWithQuery(<ConnectorSettings />);

    await userEvent.click(await screen.findByRole("button", { name: "Change Google access" }));

    await vi.waitFor(() => {
      expect(calls.some((call) => call.includes("/google-oauth/start"))).toBe(true);
    });
    const start = calls.find((call) => call.includes("/google-oauth/start"));
    expect(start).toMatch(/^POST /);
    expect(start).toContain("return=web");
  });

  // Claiming is centralized at the persistent dashboard boundary. Settings
  // must never replay authorization lifecycle writes after the API has queued
  // the durable backfill.
  it("does not claim or re-report Google authorization from Settings", async () => {
    window.history.replaceState(
      null,
      "",
      "/app/settings?settings=connections&google_session=s1&google_status=success",
    );
    const calls = mockDashboard();
    renderWithQuery(<ConnectorSettings />);

    await vi.waitFor(() => {
      expect(calls.some((call) => call.includes("/google-oauth"))).toBe(true);
    });
    expect(calls.some((call) => call.includes("/google-oauth/claim"))).toBe(false);
    expect(calls.some((call) => call.includes("/relationship-sources/google/authorization"))).toBe(
      false,
    );
  });

  // A disabled native card next to a working Composio row is the same product
  // twice, and only one of the two connect buttons does anything.
  it("drops a disabled native card for a product Composio already offers", async () => {
    mockDashboard({
      connectors: [
        connector({ name: "github", displayName: "GitHub", status: "disabled", connected: false }),
        connector({ name: "stripe", displayName: "Stripe", status: "enabled" }),
      ],
      toolkits: [{ slug: "github", name: "GitHub via Composio", managedAuth: true }],
    });
    renderWithQuery(<ConnectorSettings />);

    expect(await screen.findByText("GitHub via Composio")).toBeInTheDocument();
    expect(await screen.findByText("Stripe")).toBeInTheDocument();
    expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
  });
});
