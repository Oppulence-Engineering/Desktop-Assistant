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

/**
 * A sign-in failure phrased for the person looking at it.
 *
 * These messages are rendered verbatim in the sign-in panel, so they must not
 * name the identity provider or echo an HTTP status. "WorkOS login-url failed:
 * 503" told the user which vendor we use and nothing they could act on — and it
 * appeared for a server-side outage that had nothing to do with their account.
 *
 * The technical detail is kept on the error, not in the message, so logs and
 * diagnostics stay precise while the UI stays human.
 */
export class AuthRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Provider/endpoint context. For logs only — never displayed. */
    readonly detail: string,
  ) {
    super(message);
    this.name = "AuthRequestError";
  }
}

/**
 * Map a failed auth response to what the user should be told.
 *
 * The distinction that matters is retryable vs not. A 5xx or 429 is our problem
 * and clears on its own, so telling someone to try again shortly is true and
 * useful; anything else means the attempt itself did not succeed.
 */
function authFailure(status: number, detail: string): AuthRequestError {
  const message =
    status === 429 || status >= 500
      ? "Can't reach the sign-in service right now. Please try again in a moment."
      : "Failed to authenticate. Please try again.";
  return new AuthRequestError(message, status, detail);
}

/** Ask rowboat-api for the AuthKit authorize URL to open in the browser. */
export async function getWorkosLoginUrl(
  redirectUri: string,
  state: string,
  codeChallenge: string,
): Promise<string> {
  const u = new URL(`${API_URL}/v1/auth/workos/login-url`);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", codeChallenge);

  let res: Response;
  try {
    res = await fetch(u.toString());
  } catch (err) {
    // Offline or DNS failure: same shape as a 5xx from the user's point of view.
    throw new AuthRequestError(
      "Can't reach the sign-in service right now. Please check your connection and try again.",
      0,
      `login-url network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) throw authFailure(res.status, `login-url returned ${res.status}`);
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw authFailure(502, "login-url response missing url");
  return data.url;
}

function toTokens(b: {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}): OAuthTokens {
  if (!b.access_token) throw authFailure(502, "broker response missing access_token");
  return {
    access_token: b.access_token,
    refresh_token: b.refresh_token ?? null,
    expires_at: b.expires_at ?? Math.floor(Date.now() / 1000) + 300,
    token_type: "Bearer",
  };
}

/** Exchange an authorization code for tokens via the broker. */
export async function exchangeWorkosCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/auth/workos/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, codeVerifier }),
    });
  } catch (err) {
    throw new AuthRequestError(
      "Can't reach the sign-in service right now. Please check your connection and try again.",
      0,
      `code exchange network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) throw authFailure(res.status, `code exchange returned ${res.status}`);
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
      "Can't reach the sign-in service right now. Retrying shortly.",
      0,
      undefined,
      `token refresh network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as {
      detail?: string;
      reconnectRequired?: boolean;
    };
    if (body.reconnectRequired) {
      // Own the wording here rather than echoing `body.detail`. The server's
      // copy is fixed too, but a client that renders whatever a response hands
      // it will leak the next unguarded string someone adds upstream.
      throw new ReconnectRequiredError("Your session expired. Please sign in again.");
    }
    throw authFailure(409, `token refresh returned 409 ${body.detail ?? ""}`.trim());
  }
  if (res.status === 429 || res.status >= 500) {
    throw new TransientRefreshError(
      "Can't reach the sign-in service right now. Retrying shortly.",
      res.status,
      parseRetryAfterMs(res.headers.get("retry-after")),
      `token refresh returned ${res.status}`,
    );
  }
  if (!res.ok) throw authFailure(res.status, `token refresh returned ${res.status}`);
  return toTokens(await res.json());
}
