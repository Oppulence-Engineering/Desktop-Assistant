import { rowboatApiBaseURL, rowboatApiURL } from "@/lib/auth/config";
import { decodeUnverifiedWorkOSClaims } from "@/lib/auth/jwt";
import {
  RowboatAPIErrorSchema,
  ViewerResponseSchema,
  WorkOSLoginURLResponseSchema,
  WorkOSTokenBundleSchema,
  type DashboardSessionCookie,
  type ViewerResponse,
  type WorkOSTokenBundle,
} from "@/lib/auth/schemas";

async function parseJSON(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function rowboatFetch(pathname: string, init: RequestInit): Promise<Response> {
  return fetch(rowboatApiURL(pathname), {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
}

async function throwAPIError(res: Response, fallback: string): Promise<never> {
  const body = await parseJSON(res);
  const parsed = RowboatAPIErrorSchema.safeParse(body);
  const message = parsed.success
    ? parsed.data.message || parsed.data.error || parsed.data.code || fallback
    : fallback;
  throw new Error(message);
}

export async function getWorkOSLoginURL(input: {
  redirectURI: string;
  state: string;
  codeChallenge: string;
  provider?: string;
}): Promise<string> {
  const url = rowboatApiURL("/v1/auth/workos/login-url");
  url.searchParams.set("redirect_uri", input.redirectURI);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  if (input.provider) {
    url.searchParams.set("provider", input.provider);
  }

  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  } catch {
    throw new Error(
      `Cannot reach rowboat-api at ${rowboatApiBaseURL()}. Start rowboat-api or set ROWBOAT_WWW_API_PROXY_URL.`,
    );
  }
  if (!res.ok) {
    await throwAPIError(res, "could not start WorkOS sign-in");
  }
  return WorkOSLoginURLResponseSchema.parse(await parseJSON(res)).url;
}

export async function exchangeWorkOSCode(input: {
  code: string;
  codeVerifier: string;
}): Promise<WorkOSTokenBundle> {
  const res = await rowboatFetch("/v1/auth/workos/exchange", {
    method: "POST",
    body: JSON.stringify({
      code: input.code,
      codeVerifier: input.codeVerifier,
    }),
  });
  if (!res.ok) {
    await throwAPIError(res, "could not complete WorkOS sign-in");
  }
  return WorkOSTokenBundleSchema.parse(await parseJSON(res));
}

export async function refreshWorkOSSession(
  session: DashboardSessionCookie,
): Promise<DashboardSessionCookie | null> {
  if (!session.refreshToken) return null;
  const res = await rowboatFetch("/v1/auth/workos/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  if (!res.ok) return null;
  return sessionFromTokenBundle(WorkOSTokenBundleSchema.parse(await parseJSON(res)), session);
}

export async function fetchViewer(session: DashboardSessionCookie): Promise<ViewerResponse> {
  const res = await rowboatFetch("/v1/me", {
    method: "GET",
    headers: { Authorization: `${session.tokenType} ${session.accessToken}` },
  });
  if (!res.ok) {
    await throwAPIError(res, "could not load viewer");
  }
  return ViewerResponseSchema.parse(await parseJSON(res));
}

/**
 * Converts a rowboat-api WorkOS token bundle into the sealed browser session
 * shape. Token expiry is taken from the broker response; user metadata is read
 * from the token only as a convenience and is later reconciled with /v1/me.
 */
export function sessionFromTokenBundle(
  bundle: WorkOSTokenBundle,
  previous?: DashboardSessionCookie,
): DashboardSessionCookie {
  const claims = decodeUnverifiedWorkOSClaims(bundle.access_token);
  const now = Math.floor(Date.now() / 1000);
  return {
    version: 1,
    accessToken: bundle.access_token,
    refreshToken: bundle.refresh_token || previous?.refreshToken,
    tokenType: bundle.token_type || "Bearer",
    expiresAt: claims.exp || bundle.expires_at,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    user: {
      workosUserId: bundle.user_id || claims.sub || previous?.user.workosUserId,
      email: bundle.email || claims.email || previous?.user.email,
      sessionId: claims.sid || previous?.user.sessionId,
      organizationId: claims.org_id || previous?.user.organizationId,
      role: claims.role || previous?.user.role,
      permissions: claims.permissions || previous?.user.permissions || [],
    },
  };
}

export function shouldRefreshSession(session: DashboardSessionCookie): boolean {
  const now = Math.floor(Date.now() / 1000);
  return session.expiresAt <= now + 60;
}
