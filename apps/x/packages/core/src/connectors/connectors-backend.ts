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
