import { z } from "zod";
import { API_URL } from "../config/env.js";
import { getAccessToken } from "../auth/tokens.js";
import type {
  ConnectorEntitlement,
  ConnectorLifecycleState,
  ConnectorScope,
} from "@x/shared/connectors";

export interface ConnectorMCPToolPolicy {
  name: string;
  trustTier?: "read" | "write" | "act" | "money-moving";
}

export interface IntegrationTemplateBlock {
  id: string;
  title: string;
  description: string;
  category: string;
  requiredScopes?: string[];
  mcpTools?: string[];
  nativeTools?: string[];
  trustTier: "read" | "write" | "act" | "money-moving";
  samplePrompt?: string;
}

export interface ConnectorView {
  name: string;
  displayName: string;
  description: string;
  mcpUrl: string;
  transport?: "mcp" | "native";
  authType: "oauth" | "api_key";
  scopes?: string[];
  grantedScopes?: ConnectorScope[];
  availableScopes?: ConnectorScope[];
  connectionHealth?: ConnectorLifecycleState;
  connectionHealthMessage?: string;
  entitlement?: ConnectorEntitlement;
  status?: string;
  iconUrl?: string;
  mcpTools?: ConnectorMCPToolPolicy[];
  nativeTools?: ConnectorMCPToolPolicy[];
  templateBlocks?: IntegrationTemplateBlock[];
  connected: boolean;
  connectedAt?: string;
  lastUsedAt?: string;
}

export interface ConnectorsListResponse {
  connectors: ConnectorView[];
}
export interface ConnectorMCPTokenResponse {
  access_token: string;
  token_type?: string;
  expires_at?: number;
  mcpUrl: string;
}
export interface HubSpotSearchResponse {
  objectType: "contact" | "company" | "deal" | "ticket";
  total: number;
  results: Array<{
    id: string;
    properties: Record<string, string>;
    createdAt?: string;
    updatedAt?: string;
    archived?: boolean;
  }>;
}

const scopeInputSchema = z.union([
  z.string(),
  z
    .object({
      name: z.string(),
      displayName: z.string().optional(),
      display_name: z.string().optional(),
      description: z.string().optional(),
      tier: z.string().optional(),
      risk: z.string().optional(),
      required: z.boolean().optional(),
      requiresStepUp: z.boolean().optional(),
      requires_step_up: z.boolean().optional(),
      requiresPerInvocationApproval: z.boolean().optional(),
      requires_per_invocation_approval: z.boolean().optional(),
    })
    .passthrough(),
]);

const connectorInputSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    displayName: z.string().optional(),
    display_name: z.string().optional(),
    description: z.string().optional(),
    mcpUrl: z.string().optional(),
    mcp_url: z.string().optional(),
    transport: z.enum(["mcp", "native"]).optional(),
    authType: z.enum(["oauth", "api_key"]).optional(),
    auth_type: z.enum(["oauth", "api_key"]).optional(),
    scopes: z.array(scopeInputSchema).optional(),
    grantedScopes: z.array(scopeInputSchema).optional(),
    granted_scopes: z.array(scopeInputSchema).optional(),
    availableScopes: z.array(scopeInputSchema).optional(),
    available_scopes: z.array(scopeInputSchema).optional(),
    connected: z.boolean().optional(),
    connectionHealth: z.string().optional(),
    connection_health: z.string().optional(),
    connectionHealthMessage: z.string().optional(),
    connection_health_message: z.string().optional(),
    health: z.string().optional(),
    reason: z.string().optional(),
    connection: z
      .object({
        health: z.string().optional(),
        state: z.string().optional(),
        reason: z.string().optional(),
      })
      .passthrough()
      .optional(),
    entitlement: z.unknown().optional(),
    requires_entitlement: z.string().optional(),
    status: z.string().optional(),
    iconUrl: z.string().optional(),
    icon_url: z.string().optional(),
    mcpTools: z.array(z.any()).optional(),
    nativeTools: z.array(z.any()).optional(),
    templateBlocks: z.array(z.any()).optional(),
    connectedAt: z.string().optional(),
    connected_at: z.string().optional(),
    lastUsedAt: z.string().optional(),
    last_used_at: z.string().optional(),
  })
  .passthrough();

const lifecycleStates = new Set<ConnectorLifecycleState>([
  "active",
  "reauth_required",
  "revoking",
  "revoked",
  "invalidated",
  "error",
]);
function normalizeScope(value: z.infer<typeof scopeInputSchema>): ConnectorScope {
  if (typeof value === "string") return { name: value, displayName: value };
  const tier =
    value.tier === "low" ||
    value.tier === "medium" ||
    value.tier === "high" ||
    value.tier === "money-moving" ||
    value.tier === "read" ||
    value.tier === "write" ||
    value.tier === "act" ||
    value.tier === "money_moving"
      ? value.tier
      : undefined;
  return {
    name: value.name,
    displayName: value.displayName ?? value.display_name ?? value.name,
    description: value.description,
    tier,
    risk: value.risk,
    required: value.required,
    requiresStepUp: value.requiresStepUp ?? value.requires_step_up,
    requiresPerInvocationApproval:
      value.requiresPerInvocationApproval ?? value.requires_per_invocation_approval,
  };
}
function normalizeEntitlement(
  value: unknown,
  requirement?: string,
): ConnectorEntitlement | undefined {
  if (!value && !requirement) return undefined;
  const parsed = z
    .object({
      allowed: z.boolean().optional(),
      reason: z.string().optional(),
      requiredPlan: z.string().optional(),
      required_plan: z.string().optional(),
      upgradeUrl: z.string().optional(),
      upgrade_url: z.string().optional(),
    })
    .passthrough()
    .safeParse(value ?? {});
  if (!parsed.success)
    return requirement ? { allowed: true, requiredPlan: requirement } : undefined;
  return {
    allowed: parsed.data.allowed ?? true,
    reason: parsed.data.reason,
    requiredPlan: parsed.data.requiredPlan ?? parsed.data.required_plan ?? requirement,
    upgradeUrl: parsed.data.upgradeUrl ?? parsed.data.upgrade_url,
  };
}

export function parseConnectorsListResponse(value: unknown): ConnectorsListResponse {
  const root = z.object({ connectors: z.array(connectorInputSchema) }).parse(value);
  return {
    connectors: root.connectors.map((raw) => {
      const name = raw.id ?? raw.name;
      if (!name) throw new Error("connector list item returned no id or name");
      const healthValue =
        raw.connectionHealth ??
        raw.connection_health ??
        raw.connection?.health ??
        raw.connection?.state ??
        raw.health;
      const connectionHealth =
        healthValue && lifecycleStates.has(healthValue as ConnectorLifecycleState)
          ? (healthValue as ConnectorLifecycleState)
          : undefined;
      const legacyScopes = (raw.scopes ?? []).map(normalizeScope);
      const grantedScopes = (
        raw.grantedScopes ??
        raw.granted_scopes ??
        (raw.connected ? raw.scopes : []) ??
        []
      ).map(normalizeScope);
      const availableScopes = (raw.availableScopes ?? raw.available_scopes ?? raw.scopes ?? []).map(
        normalizeScope,
      );
      return {
        name,
        displayName: raw.displayName ?? raw.display_name ?? name,
        description: raw.description ?? "",
        mcpUrl: raw.mcpUrl ?? raw.mcp_url ?? "",
        transport: raw.transport,
        authType: raw.authType ?? raw.auth_type ?? "oauth",
        scopes: legacyScopes.map((scope) => scope.name),
        grantedScopes,
        availableScopes,
        connectionHealth,
        connectionHealthMessage:
          raw.connectionHealthMessage ??
          raw.connection_health_message ??
          raw.connection?.reason ??
          raw.reason,
        entitlement: normalizeEntitlement(raw.entitlement, raw.requires_entitlement),
        status: raw.status,
        iconUrl: raw.iconUrl ?? raw.icon_url,
        mcpTools: raw.mcpTools,
        nativeTools: raw.nativeTools,
        templateBlocks: raw.templateBlocks,
        connected: raw.connected ?? connectionHealth === "active",
        connectedAt: raw.connectedAt ?? raw.connected_at,
        lastUsedAt: raw.lastUsedAt ?? raw.last_used_at,
      };
    }),
  };
}

export function parseConnectorStartResponse(value: unknown): {
  authorizationUrl: string;
  expiresAt?: string;
} {
  const body = z
    .object({
      authorization_url: z.string().optional(),
      authorize_url: z.string().optional(),
      authorizationUrl: z.string().optional(),
      expires_at: z.string().optional(),
      expiresAt: z.string().optional(),
    })
    .parse(value);
  const authorizationUrl = body.authorization_url ?? body.authorizationUrl ?? body.authorize_url;
  if (!authorizationUrl) throw new Error("connector start returned no authorization_url");
  const url = new URL(authorizationUrl);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))
  )
    throw new Error("connector start returned an unsafe authorization URL");
  return { authorizationUrl, expiresAt: body.expires_at ?? body.expiresAt };
}

async function request(
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
): Promise<Response> {
  const bearer = await getAccessToken();
  return fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as Record<string, string>;
    return body.detail ?? body.error ?? body.title ?? body.code ?? "";
  } catch {
    return "";
  }
}

export async function startConnectorViaBackend(
  connector: string,
  options: { requestedScopes?: string[]; redirectAfter?: string } = {},
): Promise<string> {
  if (
    options.redirectAfter &&
    !/^(?:solomon-ai|rowboat):\/\/[a-z0-9/_?=&.-]+$/i.test(options.redirectAfter)
  )
    throw new Error("connector start redirect_after is not an allowed desktop URL");
  const res = await request(`/v1/connections/${encodeURIComponent(connector)}/start`, "POST", {
    requested_scopes: options.requestedScopes,
    redirect_after: options.redirectAfter,
  });
  if (!res.ok)
    throw new Error(`connector start failed: ${res.status} ${await readError(res)}`.trim());
  return parseConnectorStartResponse(await res.json()).authorizationUrl;
}
export async function listConnectorsViaBackend(): Promise<ConnectorsListResponse> {
  const res = await request("/v1/connectors", "GET");
  if (!res.ok)
    throw new Error(`connector list failed: ${res.status} ${await readError(res)}`.trim());
  return parseConnectorsListResponse(await res.json());
}
export async function saveConnectorAPIKeyViaBackend(
  connector: string,
  apiKey: string,
): Promise<void> {
  const res = await request(`/v1/connections/${encodeURIComponent(connector)}/api-key`, "POST", {
    apiKey,
  });
  if (!res.ok)
    throw new Error(`connector api key save failed: ${res.status} ${await readError(res)}`.trim());
}
export async function getConnectorMCPTokenViaBackend(
  connector: string,
): Promise<ConnectorMCPTokenResponse> {
  const res = await request(
    `/v1/connections/${encodeURIComponent(connector)}/mcp-token`,
    "POST",
    {},
  );
  if (!res.ok)
    throw new Error(`connector mcp token failed: ${res.status} ${await readError(res)}`.trim());
  return (await res.json()) as ConnectorMCPTokenResponse;
}
export async function searchHubSpotViaBackend(input: {
  objectType: "contact" | "company" | "deal" | "ticket";
  query: string;
  limit?: number;
}): Promise<HubSpotSearchResponse> {
  const res = await request("/v1/hubspot/search", "POST", input);
  if (!res.ok)
    throw new Error(`HubSpot search failed: ${res.status} ${await readError(res)}`.trim());
  return (await res.json()) as HubSpotSearchResponse;
}
export async function claimConnectorViaBackend(connector: string, state: string): Promise<void> {
  const res = await request(`/v1/connections/${encodeURIComponent(connector)}/claim`, "POST", {
    state,
  });
  if (!res.ok)
    throw new Error(`connector claim failed: ${res.status} ${await readError(res)}`.trim());
}
export async function deleteConnectorViaBackend(connector: string): Promise<void> {
  const res = await request(`/v1/connections/${encodeURIComponent(connector)}`, "DELETE");
  if (!res.ok && res.status !== 204)
    throw new Error(`connector delete failed: ${res.status} ${await readError(res)}`.trim());
}
