import type { Connector } from "@/lib/api/generated/client/model";
import type {
  claimConnectionResponse,
  startConnectionResponse,
} from "@/lib/api/generated/client/connectors/connectors";

export const HOSTED_CONNECTOR_CALLBACK_PATH = "/api/connectors/oauth/callback";
const CONNECTOR_SETTINGS_PATH = "/app/settings?settings=connections";

export type HostedOAuthOutcome =
  "active" | "entitlement" | "error" | "expired" | "replay" | "restart" | "retry" | "scope";

export function isConnectorSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
}

export function requiredConnectorScopes(connector: Connector): string[] {
  return (connector.availableScopes ?? [])
    .filter((scope) => scope.grantTier === "required")
    .map((scope) => scope.name);
}

export function hostedOAuthUnsupportedReason(connector: Connector): string | null {
  if (connector.authType !== "oauth") return "This connector does not use hosted OAuth.";
  if (connector.status !== "enabled") return "This connector is not currently enabled.";
  if (connector.health === "unavailable" || connector.connectionHealth === "disabled") {
    return connector.connectionReason || "Hosted authorization is currently unavailable.";
  }
  if (!connector.availableScopes) {
    return "Hosted authorization is unavailable because its scope catalog is missing.";
  }
  return null;
}

function responseCode(
  data: claimConnectionResponse["data"] | startConnectionResponse["data"],
): string {
  if (!data || typeof data !== "object" || !("code" in data)) return "";
  return typeof data.code === "string" ? data.code : "";
}

export function claimOutcome(response: claimConnectionResponse): HostedOAuthOutcome {
  if (response.status === 200) return "active";

  const code = responseCode(response.data);
  if (response.status === 400 && (code === "scope_escalation" || code === "invalid_scope")) {
    return "scope";
  }
  if (response.status === 403) return "entitlement";
  if (response.status === 404 || response.status === 410 || code === "ticket_expired") {
    return "expired";
  }
  if (response.status === 409 && code === "replay") return "replay";
  if (
    response.status === 409 &&
    (code === "not_ready" || code === "authorization_restart_required")
  ) {
    return "restart";
  }
  if (response.status === 429) return "retry";
  return "error";
}

export function startOutcome(
  response: startConnectionResponse,
): Exclude<HostedOAuthOutcome, "active"> {
  const code = responseCode(response.data);
  if (response.status === 400 && (code === "invalid_scope" || code === "scope_escalation")) {
    return "scope";
  }
  if (response.status === 403) return "entitlement";
  if (response.status === 409) return "restart";
  if (response.status === 429) return "retry";
  return "error";
}

export function callbackStatusOutcome(status: string | null): HostedOAuthOutcome | null {
  if (status === "restart_required") return "restart";
  if (status === "error") return "error";
  return null;
}

export function connectorSettingsURL(
  origin: string,
  outcome: HostedOAuthOutcome,
  connector?: string,
): URL {
  const url = new URL(CONNECTOR_SETTINGS_PATH, origin);
  url.searchParams.set("connector_oauth", outcome);
  if (connector && isConnectorSlug(connector)) url.searchParams.set("connector", connector);
  return url;
}

export function safeAuthorizationURL(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:") return url;
    if (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    ) {
      return url;
    }
  } catch {
    // The generated contract requires an absolute URL. Invalid upstream data fails closed.
  }
  return null;
}
