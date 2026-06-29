import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { rowboatApiURL } from "@/lib/auth/config";
import { clearAuthCookies, readSessionCookie, setSessionCookie } from "@/lib/auth/cookies";
import { refreshWorkOSSession, shouldRefreshSession } from "@/lib/auth/rowboat-api";
import type { DashboardSessionCookie } from "@/lib/auth/schemas";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const RESPONSE_HEADERS = [
  "cache-control",
  "content-language",
  "content-type",
  "etag",
  "expires",
  "last-modified",
  "pragma",
  "retry-after",
  "x-rowboat-session-id",
];

export type AuthorizedSessionResult =
  | { ok: true; session: DashboardSessionCookie; refreshed?: DashboardSessionCookie }
  | { ok: false; response: NextResponse };

/**
 * Reads, verifies, and refreshes the dashboard session before a protected route
 * talks to rowboat-api. Missing or expired sessions fail closed with 401.
 */
export async function getAuthorizedSession(request: NextRequest): Promise<AuthorizedSessionResult> {
  let session = readSessionCookie(request);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthenticated", code: "unauthorized" }, { status: 401 }),
    };
  }

  if (shouldRefreshSession(session)) {
    const refreshed = await refreshWorkOSSession(session);
    if (!refreshed) {
      const response = NextResponse.json(
        { error: "session expired", code: "unauthorized" },
        { status: 401 },
      );
      clearAuthCookies(response);
      return { ok: false, response };
    }
    session = refreshed;
    return { ok: true, session, refreshed };
  }

  return { ok: true, session };
}

/**
 * Converts /api/rowboat/... proxy paths to rowboat-api paths. Dashboard code is
 * expected to call /api/rowboat/v1/...; a missing v1 is still forced under /v1
 * so the proxy cannot reach unrelated upstream paths.
 */
export function dashboardProxyPath(path: string[]): string {
  const cleaned = path.map((part) => encodeURIComponent(part)).join("/");
  if (!cleaned) return "/v1/me";
  if (path[0] === "v1") return `/${cleaned}`;
  return `/v1/${cleaned}`;
}

export async function proxyRowboatAPI(
  request: NextRequest,
  path: string[],
): Promise<NextResponse> {
  const auth = await getAuthorizedSession(request);
  if (!auth.ok) return auth.response;

  const upstreamURL = rowboatApiURL(dashboardProxyPath(path), request.nextUrl.searchParams);
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });
  headers.set("Authorization", `${auth.session.tokenType} ${auth.session.accessToken}`);

  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  const upstream = await fetch(upstreamURL, {
    method,
    headers,
    body,
    cache: "no-store",
  });

  const responseHeaders = new Headers();
  for (const header of RESPONSE_HEADERS) {
    const value = upstream.headers.get(header);
    if (value) responseHeaders.set(header, value);
  }

  const response = new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });

  if (auth.refreshed) {
    setSessionCookie(response, auth.refreshed);
  }
  if (upstream.status === 401) {
    clearAuthCookies(response);
  }

  return response;
}
