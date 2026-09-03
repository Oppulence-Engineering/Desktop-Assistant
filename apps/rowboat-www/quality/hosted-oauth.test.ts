import { describe, expect, it } from "vitest";

import type {
  claimConnectionResponse,
  startConnectionResponse,
} from "@/lib/api/generated/client/connectors/connectors";
import {
  callbackStatusOutcome,
  claimOutcome,
  connectorSettingsURL,
  safeAuthorizationURL,
  startOutcome,
} from "@/lib/connectors/hosted-oauth";

function claim(status: claimConnectionResponse["status"], code = "") {
  return {
    status,
    data:
      status === 200
        ? { connected: true }
        : {
            code,
            status,
            title: "Connector error",
            type: "about:blank",
          },
    headers: new Headers(),
  } as claimConnectionResponse;
}

function start(status: startConnectionResponse["status"], code = "") {
  return {
    status,
    data:
      status === 200
        ? {
            authorization_url: "https://broker.example/authorize",
            authorize_url: "https://broker.example/authorize",
            expires_at: "2026-08-28T01:35:00Z",
          }
        : {
            code,
            status,
            title: "Connector error",
            type: "about:blank",
          },
    headers: new Headers(),
  } as startConnectionResponse;
}

describe("hosted connector OAuth outcomes", () => {
  it("maps the generated claim contract across active and failure outcomes", () => {
    expect(claimOutcome(claim(200))).toBe("active");
    expect(claimOutcome(claim(400, "scope_escalation"))).toBe("scope");
    expect(claimOutcome(claim(403, "plan_required"))).toBe("entitlement");
    expect(claimOutcome(claim(404, "ticket_expired"))).toBe("expired");
    expect(claimOutcome(claim(410, "ticket_expired"))).toBe("expired");
    expect(claimOutcome(claim(409, "replay"))).toBe("replay");
    expect(claimOutcome(claim(409, "authorization_restart_required"))).toBe("restart");
    expect(claimOutcome(claim(429, "rate_limited"))).toBe("retry");
    expect(claimOutcome(claim(503, "connector_disabled"))).toBe("error");
  });

  it("maps generated start failures and provider callback restart states", () => {
    expect(startOutcome(start(400, "invalid_scope"))).toBe("scope");
    expect(startOutcome(start(403, "plan_required"))).toBe("entitlement");
    expect(startOutcome(start(409, "authorization_restart_required"))).toBe("restart");
    expect(startOutcome(start(429, "rate_limited"))).toBe("retry");
    expect(callbackStatusOutcome("restart_required")).toBe("restart");
    expect(callbackStatusOutcome("error")).toBe("error");
    expect(callbackStatusOutcome("success")).toBeNull();
  });

  it("never places the one-time claim state in the settings outcome URL", () => {
    const url = connectorSettingsURL("https://app.example", "replay", "google");
    expect(url.toString()).toBe(
      "https://app.example/app/settings?settings=connections&connector_oauth=replay&connector=google",
    );
    expect(url.search).not.toContain("session");
    expect(url.search).not.toContain("state");
  });

  it("accepts HTTPS and loopback authorization URLs but rejects unsafe schemes", () => {
    expect(safeAuthorizationURL("https://broker.example/authorize")?.hostname).toBe(
      "broker.example",
    );
    expect(safeAuthorizationURL("http://127.0.0.1:4318/authorize")?.port).toBe("4318");
    expect(safeAuthorizationURL("javascript:alert(1)")).toBeNull();
    expect(safeAuthorizationURL("http://evil.example/authorize")).toBeNull();
  });
});
