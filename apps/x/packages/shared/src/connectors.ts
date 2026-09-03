import { z } from "zod";

export const ConnectorLifecycleStateSchema = z.enum([
  "active",
  "reauth_required",
  "revoking",
  "revoked",
  "invalidated",
  "error",
]);

export const ConnectorTrustTierSchema = z.enum([
  "low",
  "medium",
  "high",
  "money-moving",
  "read",
  "write",
  "act",
  "money_moving",
]);

export const ConnectorScopeSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  tier: ConnectorTrustTierSchema.optional(),
  risk: z.string().optional(),
  required: z.boolean().optional(),
  requiresStepUp: z.boolean().optional(),
  requiresPerInvocationApproval: z.boolean().optional(),
});

export const ConnectorEntitlementSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
  requiredPlan: z.string().optional(),
  upgradeUrl: z.string().optional(),
});

export type ConnectorLifecycleState = z.infer<typeof ConnectorLifecycleStateSchema>;
export type ConnectorScope = z.infer<typeof ConnectorScopeSchema>;
export type ConnectorEntitlement = z.infer<typeof ConnectorEntitlementSchema>;

export type ConnectorLifecycleAction =
  | "connect"
  | "disconnect"
  | "reconnect"
  | "wait"
  | "unavailable"
  | "retry";

export function connectorLifecycleAction(input: {
  connected: boolean;
  connectionHealth?: ConnectorLifecycleState;
  entitlement?: ConnectorEntitlement;
}): ConnectorLifecycleAction {
  if (input.entitlement?.allowed === false) return "unavailable";
  switch (input.connectionHealth) {
    case "active":
      return "disconnect";
    case "reauth_required":
      return "reconnect";
    case "revoking":
      return "wait";
    case "invalidated":
      return "unavailable";
    case "error":
      return "retry";
    case "revoked":
      return "connect";
    default:
      return input.connected ? "disconnect" : "connect";
  }
}
