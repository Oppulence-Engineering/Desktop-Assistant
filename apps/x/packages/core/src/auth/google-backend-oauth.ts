import { API_URL } from "../config/env.js";
import { getAccessToken } from "./tokens.js";
import { OAuthTokens } from "./types.js";

/**
 * Client for the rowboat-mode Google OAuth endpoints on the api:
 *   POST /v1/google-oauth/start   — mint a state ticket bound to this user and
 *                                   return Google's authorize URL to open
 *   POST /v1/google-oauth/claim   — one-shot retrieval of tokens parked by
 *                                   the api's callback under that `state`
 *   POST /v1/google-oauth/refresh — exchange a refresh_token for fresh tokens
 *                                   (the secret-requiring step that can't
 *                                   happen on the desktop)
 *
 * All three are called with the user's Rowboat bearer (via getAccessToken).
 *
 * The callback lives on the api (`GET /oauth/google/callback`), not the webapp.
 * It used to be a webapp route, and the desktop went on opening
 * `<webapp>/oauth/google/start` for a while after the move — a URL that 404s.
 * Going through `start` here means the desktop never hardcodes that path again.
 *
 * The api response shape uses `scope: string` (space-delimited); we convert
 * to the desktop's `scopes: string[]`. On refresh, api may omit `scope` and
 * `refresh_token` — caller-provided existingScopes / refreshToken are
 * preserved in those cases (Google rarely rotates refresh tokens).
 */

// Error classes live in refresh-errors.ts (shared with the WorkOS refresh
// path); re-exported here so existing importers keep working.
import { ReconnectRequiredError, TransientRefreshError } from "./refresh-errors.js";
export { ReconnectRequiredError, TransientRefreshError };

interface ApiTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope?: string;
  token_type?: string;
}

function toOAuthTokens(
  body: ApiTokenResponse,
  fallbackRefreshToken: string | null = null,
  fallbackScopes?: string[],
): OAuthTokens {
  const refresh_token = body.refresh_token ?? fallbackRefreshToken;
  const scopes = body.scope ? body.scope.split(" ").filter((s) => s.length > 0) : fallbackScopes;
  return {
    access_token: body.access_token,
    refresh_token,
    expires_at: body.expires_at,
    token_type: "Bearer",
    scopes,
  };
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

interface ErrorBody {
  error?: string;
  reconnectRequired?: boolean;
}

async function readError(res: Response): Promise<ErrorBody> {
  try {
    return (await res.json()) as ErrorBody;
  } catch {
    return {};
  }
}

/**
 * Ask the api to start a managed Google connect and return the URL to open.
 *
 * The api holds the Google client secret and binds the state ticket to the
 * signed-in user before the browser ever reaches Google, so the desktop's only
 * job is to open what it's handed.
 *
 * The returned URL goes to `shell.openExternal`, so it is validated rather than
 * trusted: https only. That is cheap here and the alternative — handing an
 * unchecked string to the OS URL opener — is worth avoiding even for our own api.
 */
export async function startGoogleConnectViaBackend(): Promise<string> {
  let res: Response;
  try {
    res = await postWithBearer("/v1/google-oauth/start", {});
  } catch (err) {
    throw new Error(
      `Couldn't reach the server to start Google setup. ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (res.status === 401) {
    throw new Error("Sign in to Oppulence before connecting Google.");
  }
  if (!res.ok) {
    const err = await readError(res);
    throw new Error(
      `Couldn't start Google setup: ${res.status} ${err.error ?? ""}`.trim(),
    );
  }
  const body = (await res.json()) as { authorizeUrl?: string };
  if (!body.authorizeUrl) {
    throw new Error("Couldn't start Google setup: the server returned no authorize URL.");
  }
  let parsed: URL;
  try {
    parsed = new URL(body.authorizeUrl);
  } catch {
    throw new Error("Couldn't start Google setup: the server returned a malformed URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Couldn't start Google setup: refusing to open a non-https URL.");
  }
  return parsed.toString();
}

/** Claim the tokens parked under `state` after the api finished its callback. */
export async function claimTokensViaBackend(state: string): Promise<OAuthTokens> {
  const res = await postWithBearer("/v1/google-oauth/claim", { session: state });
  if (!res.ok) {
    const err = await readError(res);
    throw new Error(`claim failed: ${res.status} ${err.error ?? ""}`.trim());
  }
  const body = (await res.json()) as ApiTokenResponse;
  return toOAuthTokens(body);
}

/**
 * Refresh an access token via the api. Preserves caller's `refreshToken` and
 * `existingScopes` when Google omits them on the refresh response.
 */
export async function refreshTokensViaBackend(
  refreshToken: string,
  existingScopes?: string[],
): Promise<OAuthTokens> {
  const res = await postWithBearer("/v1/google-oauth/refresh", { refreshToken });
  if (res.status === 409) {
    const err = await readError(res);
    if (err.reconnectRequired) {
      throw new ReconnectRequiredError(err.error ?? "Reconnect required");
    }
    throw new Error(`refresh failed: 409 ${err.error ?? ""}`.trim());
  }
  // 429 = backend dedup said another refresh is in flight; 5xx = upstream
  // hiccup. Either way the local tokens are still valid for the next attempt
  // — surface as TransientRefreshError so the factory doesn't write a stuck
  // error into oauth.json.
  if (res.status === 429 || res.status >= 500) {
    const err = await readError(res);
    throw new TransientRefreshError(
      `refresh failed: ${res.status} ${err.error ?? ""}`.trim(),
      res.status,
    );
  }
  if (!res.ok) {
    const err = await readError(res);
    throw new Error(`refresh failed: ${res.status} ${err.error ?? ""}`.trim());
  }
  const body = (await res.json()) as ApiTokenResponse;
  return toOAuthTokens(body, refreshToken, existingScopes);
}
