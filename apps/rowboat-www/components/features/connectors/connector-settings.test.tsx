// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Connector } from "@/lib/api/generated/client/model";

import { ConnectorSettings } from "./connector-settings";

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
    if (String(input).includes("/api/connectors/")) {
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/app/settings?settings=connections");
});

describe("hosted connector settings", () => {
  it("starts from the actual Connect control with explicit required scopes", async () => {
    const fetchMock = mockConnectors(connector());
    render(<ConnectorSettings />);

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
    render(<ConnectorSettings />);

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
    render(<ConnectorSettings />);

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
    render(<ConnectorSettings />);

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
