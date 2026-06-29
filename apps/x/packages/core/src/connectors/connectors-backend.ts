import { API_URL } from "../config/env.js";
import { getAccessToken } from "../auth/tokens.js";

/**
 * Client for the rowboat-api connector OAuth-broker endpoints:
 *   POST /v1/connections/{name}/start  — begin a connect; returns the provider
 *                                        authorize_url to open in the browser.
 *                                        Binds a pending ticket to the caller
 *                                        (via the bearer).
 *   POST /v1/connections/{name}/claim  — after the browser deep-links back,
 *                                        redeem the grant the callback parked
 *                                        under `state` and persist the
 *                                        connection. The api verifies the bearer
 *                                        user is the one who STARTED the flow —
 *                                        this binding is what prevents an
 *                                        attacker from capturing a phished
 *                                        victim's connector grant
 *                                        (authorization-code injection).
 *
 * Both are called with the user's Rowboat bearer (via getAccessToken). The
 * connection (and its refresh token) lives server-side; the desktop fetches
 * short-lived access separately via /mcp-token, so there is nothing to store
 * locally on claim.
 */

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
    trustTier: "read" | "write" | "act" | "money-moving";
    samplePrompt?: string;
}

export interface ConnectorView {
    name: string;
    displayName: string;
    description: string;
    mcpUrl: string;
    authType: "oauth" | "api_key";
    scopes?: string[];
    iconUrl?: string;
    mcpTools?: ConnectorMCPToolPolicy[];
    templateBlocks?: IntegrationTemplateBlock[];
    connected: boolean;
    connectedAt?: string;
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

async function getWithBearer(path: string): Promise<Response> {
    const bearer = await getAccessToken();
    return fetch(`${API_URL}${path}`, {
        method: "GET",
        headers: {
            authorization: `Bearer ${bearer}`,
        },
    });
}

async function postWithBearer(path: string, body: unknown): Promise<Response> {
    const bearer = await getAccessToken();
    return fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(body),
    });
}

/** Reads a human-readable message from an RFC 9457 problem+json error body. */
async function readError(res: Response): Promise<string> {
    try {
        const body = (await res.json()) as { detail?: string; title?: string; code?: string; error?: string };
        return body.detail ?? body.error ?? body.title ?? body.code ?? "";
    } catch {
        return "";
    }
}

async function deleteWithBearer(path: string): Promise<Response> {
    const bearer = await getAccessToken();
    return fetch(`${API_URL}${path}`, {
        method: "DELETE",
        headers: {
            authorization: `Bearer ${bearer}`,
        },
    });
}

/** Begin a connector OAuth connect; returns the provider authorize URL to open. */
export async function startConnectorViaBackend(connector: string): Promise<string> {
    const res = await postWithBearer(`/v1/connections/${encodeURIComponent(connector)}/start`, {});
    if (!res.ok) {
        throw new Error(`connector start failed: ${res.status} ${await readError(res)}`.trim());
    }
    const body = (await res.json()) as { authorize_url?: string };
    if (!body.authorize_url) {
        throw new Error("connector start returned no authorize_url");
    }
    return body.authorize_url;
}

/** List available Rowboat integrations and the user's connection state. */
export async function listConnectorsViaBackend(): Promise<ConnectorsListResponse> {
    const res = await getWithBearer("/v1/connectors");
    if (!res.ok) {
        throw new Error(`connector list failed: ${res.status} ${await readError(res)}`.trim());
    }
    return (await res.json()) as ConnectorsListResponse;
}

/** Save a vendor API key for an api_key connector. */
export async function saveConnectorAPIKeyViaBackend(connector: string, apiKey: string): Promise<void> {
    const res = await postWithBearer(`/v1/connections/${encodeURIComponent(connector)}/api-key`, { apiKey });
    if (!res.ok) {
        throw new Error(`connector api key save failed: ${res.status} ${await readError(res)}`.trim());
    }
}

/** Mint a short-lived credential for a connected integration MCP endpoint. */
export async function getConnectorMCPTokenViaBackend(connector: string): Promise<ConnectorMCPTokenResponse> {
    const res = await postWithBearer(`/v1/connections/${encodeURIComponent(connector)}/mcp-token`, {});
    if (!res.ok) {
        throw new Error(`connector mcp token failed: ${res.status} ${await readError(res)}`.trim());
    }
    return (await res.json()) as ConnectorMCPTokenResponse;
}

/**
 * Redeem the connector grant parked under `state` by the browser callback. The
 * api persists the connection server-side; there is no local token to store.
 */
export async function claimConnectorViaBackend(connector: string, state: string): Promise<void> {
    const res = await postWithBearer(`/v1/connections/${encodeURIComponent(connector)}/claim`, { state });
    if (!res.ok) {
        throw new Error(`connector claim failed: ${res.status} ${await readError(res)}`.trim());
    }
}

/** Disconnect a Rowboat integration. */
export async function deleteConnectorViaBackend(connector: string): Promise<void> {
    const res = await deleteWithBearer(`/v1/connections/${encodeURIComponent(connector)}`);
    if (!res.ok && res.status !== 204) {
        throw new Error(`connector delete failed: ${res.status} ${await readError(res)}`.trim());
    }
}
