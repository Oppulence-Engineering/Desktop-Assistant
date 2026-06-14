/**
 * WorkOS sign-in via the rowboat-api broker.
 *
 * WorkOS AuthKit is a confidential client: the authorization-code → token
 * exchange must present the WorkOS API key, which the desktop must not hold.
 * So the desktop runs the browser authorize + PKCE itself, then hands the code
 * to rowboat-api, which completes the exchange server-side. This replaces the
 * direct openid-client token exchange for the `rowboat` provider.
 * See apps/rowboat-api/AUTH.md.
 */
import { API_URL } from "../config/env.js";
import {
  ReconnectRequiredError,
  TransientRefreshError,
  parseRetryAfterMs,
} from "./refresh-errors.js";
import { OAuthTokens } from "./types.js";

/** Ask rowboat-api for the WorkOS AuthKit authorize URL to open in the browser. */
export async function getWorkosLoginUrl(
  redirectUri: string,
  state: string,
  codeChallenge: string,
): Promise<string> {
  const u = new URL(`${API_URL}/v1/auth/workos/login-url`);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", codeChallenge);
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`WorkOS login-url failed: ${res.status}`);
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error("WorkOS login-url response missing url");
  return data.url;
}

function toTokens(b: {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}): OAuthTokens {
  if (!b.access_token) throw new Error("WorkOS broker response missing access_token");
  return {
    access_token: b.access_token,
    refresh_token: b.refresh_token ?? null,
    expires_at: b.expires_at ?? Math.floor(Date.now() / 1000) + 300,
    token_type: "Bearer",
  };
}

/** Exchange a WorkOS authorization code for tokens via the broker. */
export async function exchangeWorkosCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
  const res = await fetch(`${API_URL}/v1/auth/workos/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, codeVerifier }),
  });
  if (!res.ok) throw new Error(`WorkOS code exchange failed: ${res.status}`);
  return toTokens(await res.json());
}

/**
 * Refresh rowboat tokens via the broker, classifying failures so callers can
 * tell "sign in again" from "back off and retry" (mirrors the Google path in
 * google-backend-oauth.ts):
 *
 *   409 + reconnectRequired → ReconnectRequiredError (WorkOS invalid_grant —
 *     the rotating refresh token is consumed; only re-auth recovers).
 *   429 / ≥500 / network    → TransientRefreshError (Retry-After honored).
 *   other non-OK            → generic Error (callers treat as transient;
 *     never destroy session state on an unclassified failure).
 */
export async function refreshWorkosTokens(refreshToken: string): Promise<OAuthTokens> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/auth/workos/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch (err) {
    throw new TransientRefreshError(
      `WorkOS token refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as {
      detail?: string;
      reconnectRequired?: boolean;
    };
    if (body.reconnectRequired) {
      throw new ReconnectRequiredError(body.detail ?? "WorkOS session expired; sign in again.");
    }
    throw new Error(`WorkOS token refresh failed: 409 ${body.detail ?? ""}`.trim());
  }
  if (res.status === 429 || res.status >= 500) {
    throw new TransientRefreshError(
      `WorkOS token refresh failed: ${res.status}`,
      res.status,
      parseRetryAfterMs(res.headers.get("retry-after")),
    );
  }
  if (!res.ok) throw new Error(`WorkOS token refresh failed: ${res.status}`);
  return toTokens(await res.json());
}
