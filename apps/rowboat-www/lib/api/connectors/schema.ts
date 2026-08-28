import { z } from "zod";

import type {
  Connector,
  ConnectorScope,
  ConnectorsResponse,
} from "@/lib/api/generated/client/model";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isConnectorScope(value: unknown): value is ConnectorScope {
  const scope = record(value);
  return Boolean(
    scope &&
    typeof scope.description === "string" &&
    typeof scope.displayName === "string" &&
    (scope.grantTier === "required" || scope.grantTier === "optional") &&
    typeof scope.name === "string" &&
    ["low", "medium", "high", "money-moving"].includes(String(scope.risk)),
  );
}

function isConnector(value: unknown): value is Connector {
  const connector = record(value);
  return Boolean(
    connector &&
    typeof connector.audience === "string" &&
    (connector.authType === "oauth" || connector.authType === "api_key") &&
    (connector.availableScopes === undefined ||
      (Array.isArray(connector.availableScopes) &&
        connector.availableScopes.every(isConnectorScope))) &&
    typeof connector.connected === "boolean" &&
    ["healthy", "degraded", "disabled", "disconnected"].includes(
      String(connector.connectionHealth),
    ) &&
    typeof connector.description === "string" &&
    typeof connector.displayName === "string" &&
    (connector.grantedScopes === undefined ||
      (Array.isArray(connector.grantedScopes) &&
        connector.grantedScopes.every(isConnectorScope))) &&
    ["healthy", "degraded", "unavailable"].includes(String(connector.health)) &&
    typeof connector.mcpUrl === "string" &&
    typeof connector.name === "string" &&
    ["enabled", "maintenance", "disabled"].includes(String(connector.status)),
  );
}

const ConnectorsResponseSchema = z.object({
  connectors: z.array(z.custom<Connector>(isConnector, "Invalid connector contract")),
}) satisfies z.ZodType<ConnectorsResponse>;

export function parseConnectorsResponse(value: unknown): ConnectorsResponse {
  return ConnectorsResponseSchema.parse(value);
}
