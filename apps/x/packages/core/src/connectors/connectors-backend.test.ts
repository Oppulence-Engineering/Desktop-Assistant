import { describe, expect, it } from "vitest";
import { connectorLifecycleAction } from "@x/shared/connectors";
import { parseConnectorStartResponse, parseConnectorsListResponse } from "./connectors-backend.js";

describe("connector broker response parsing", () => {
  it("prefers structured RFC fields while accepting snake_case", () => {
    const result = parseConnectorsListResponse({
      connectors: [
        {
          id: "canvas",
          display_name: "Canvas",
          connected: true,
          connection_health: "active",
          granted_scopes: [{ name: "canvas.read", display_name: "Read invoices", tier: "read" }],
          available_scopes: [
            { name: "canvas.read", display_name: "Read invoices", tier: "read" },
            { name: "canvas.watch", display_name: "Watch invoices", required: false },
          ],
          entitlement: { allowed: true },
          last_used_at: "2026-08-27T12:00:00Z",
        },
      ],
    });
    expect(result.connectors[0]).toMatchObject({
      name: "canvas",
      displayName: "Canvas",
      connectionHealth: "active",
      grantedScopes: [{ name: "canvas.read", displayName: "Read invoices" }],
      lastUsedAt: "2026-08-27T12:00:00Z",
    });
  });

  it("accepts the legacy list and start shapes", () => {
    const list = parseConnectorsListResponse({
      connectors: [
        {
          name: "legacy",
          displayName: "Legacy",
          description: "Old contract",
          mcpUrl: "https://example.test/mcp",
          authType: "oauth",
          scopes: ["legacy.read"],
          connected: false,
        },
      ],
    });
    expect(list.connectors[0].availableScopes).toEqual([
      { name: "legacy.read", displayName: "legacy.read" },
    ]);
    expect(
      parseConnectorStartResponse({ authorize_url: "https://example.test/oauth" }).authorizationUrl,
    ).toBe("https://example.test/oauth");
    expect(
      parseConnectorStartResponse({ authorization_url: "https://example.test/new" })
        .authorizationUrl,
    ).toBe("https://example.test/new");
  });

  it("accepts server lifecycle health and reason without breaking legacy fields", () => {
    const result = parseConnectorsListResponse({
      connectors: [
        {
          id: "corinthian",
          connected: true,
          connection: { health: "reauth_required", reason: "Refresh token rotation failed" },
        },
      ],
    });
    expect(result.connectors[0]).toMatchObject({
      connectionHealth: "reauth_required",
      connectionHealthMessage: "Refresh token rotation failed",
      connected: true,
    });
  });

  it("rejects unsafe authorization URLs", () => {
    expect(() => parseConnectorStartResponse({ authorization_url: "javascript:alert(1)" })).toThrow(
      /unsafe/,
    );
  });
});

describe("connector lifecycle UI decisions", () => {
  it.each([
    ["healthy", undefined, true, "disconnect"],
    ["degraded", "reauth_required", false, "reconnect"],
    ["degraded", "upstream_error", false, "retry"],
    ["disabled", "revocation_pending", false, "wait"],
    ["disabled", "revoked", false, "connect"],
    ["disabled", "security_policy", false, "unavailable"],
    ["disconnected", undefined, false, "connect"],
  ] as const)(
    "maps API connectionHealth=%s reason=%s to renderer action %s",
    (connectionHealth, connectionReason, connected, expectedAction) => {
      const parsed = parseConnectorsListResponse({
        connectors: [
          {
            name: "canvas",
            displayName: "Canvas",
            description: "Banking",
            mcpUrl: "https://canvas.example/mcp",
            authType: "oauth",
            status: "enabled",
            health: "healthy",
            connected,
            connectionHealth,
            connectionReason,
            availableScopes: [
              {
                name: "canvas:payments.write",
                displayName: "Write payments",
                grantTier: "required",
                risk: "money-moving",
                stepUpRequired: true,
                perInvocationApproval: true,
              },
            ],
          },
        ],
      }).connectors[0];

      expect(connectorLifecycleAction(parsed)).toBe(expectedAction);
      expect(parsed.availableScopes?.[0]).toMatchObject({
        required: true,
        requiresStepUp: true,
        requiresPerInvocationApproval: true,
      });
    },
  );

  it.each([
    ["active", "disconnect"],
    ["reauth_required", "reconnect"],
    ["revoking", "wait"],
    ["revoked", "connect"],
    ["invalidated", "unavailable"],
    ["error", "retry"],
  ] as const)("maps %s to %s", (connectionHealth, action) => {
    expect(
      connectorLifecycleAction({ connected: connectionHealth === "active", connectionHealth }),
    ).toBe(action);
  });

  it("shows entitlement denial as unavailable instead of OAuth failure", () => {
    expect(
      connectorLifecycleAction({
        connected: false,
        entitlement: { allowed: false, reason: "plan_required" },
      }),
    ).toBe("unavailable");
  });
});
