import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { RowboatProxyPathSchema } from "@/lib/api/routes/schemas/proxy";
import { rowboatApiURL } from "@/lib/auth/config";
import { clearAuthCookies, readSessionCookie, setSessionCookie } from "@/lib/auth/cookies";
import { resolveSessionRefresh } from "@/lib/auth/session-refresh";
import type { DashboardSessionCookie } from "@/lib/auth/schemas";

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "if-match",
  "if-none-match",
  "last-event-id",
  "range",
  "x-approval-token",
  "x-continuation-token",
  "x-idempotency-key",
  "x-request-id",
] as const;

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

export function dashboardProxyHeaders(source: Headers): Headers {
  const forwarded = new Headers();
  for (const key of FORWARDED_REQUEST_HEADERS) {
    const value = source.get(key);
    if (value) forwarded.set(key, value);
  }
  return forwarded;
}

export type AuthorizedSessionResult =
  | { ok: true; session: DashboardSessionCookie; refreshed?: DashboardSessionCookie }
  | { ok: false; response: NextResponse };

/**
 * Reads, verifies, and refreshes the dashboard session before a protected route
 * talks to rowboat-api. Missing or expired sessions fail closed with 401.
 */
export async function getAuthorizedSession(request: NextRequest): Promise<AuthorizedSessionResult> {
  const session = readSessionCookie(request);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "unauthenticated", code: "unauthorized" },
        { status: 401 },
      ),
    };
  }

  const refreshedSession = await resolveSessionRefresh({
    session,
    sessionExpiredResponse: () =>
      NextResponse.json({ error: "session expired", code: "unauthorized" }, { status: 401 }),
    refreshUnavailableResponse: () =>
      NextResponse.json(
        { error: "session refresh is temporarily unavailable", code: "session_unavailable" },
        { status: 503 },
      ),
  });
  if (!refreshedSession.ok) {
    return refreshedSession;
  }
  if (refreshedSession.refreshed) {
    return {
      ok: true,
      session: refreshedSession.session,
      refreshed: refreshedSession.refreshed,
    };
  }
  return { ok: true, session: refreshedSession.session };
}

type AuthorizedSession = Extract<AuthorizedSessionResult, { ok: true }>;

/**
 * Keeps sealed session cookies in sync after a protected route talks to
 * rowboat-api. A 401 from upstream clears auth; a refresh re-seals the cookie.
 */
export function applyAuthorizedSessionCookies(
  response: NextResponse,
  auth: AuthorizedSession,
  upstreamStatus?: number,
): void {
  if (upstreamStatus === 401) {
    clearAuthCookies(response);
    return;
  }
  if (auth.refreshed) {
    setSessionCookie(response, auth.refreshed);
  }
}

function staysUnderV1Prefix(pathname: string): boolean {
  const normalized = new URL(pathname, "http://rowboat.invalid").pathname;
  return normalized === "/v1" || normalized.startsWith("/v1/");
}

/**
 * Converts /api/rowboat/... proxy paths to rowboat-api paths. Dashboard code is
 * expected to call /api/rowboat/v1/...; a missing v1 is still forced under /v1
 * so the proxy cannot reach unrelated upstream paths.
 */
export function dashboardProxyPath(path: string[]): string | null {
  const parsed = RowboatProxyPathSchema.safeParse(path);
  if (!parsed.success) return null;

  const cleaned = parsed.data.map((part) => encodeURIComponent(part)).join("/");
  const pathname = !cleaned ? "/v1/me" : path[0] === "v1" ? `/${cleaned}` : `/v1/${cleaned}`;
  return staysUnderV1Prefix(pathname) ? pathname : null;
}

export async function proxyRowboatAPI(request: NextRequest, path: string[]): Promise<NextResponse> {
  const auth = await getAuthorizedSession(request);
  if (!auth.ok) return auth.response;

  const upstreamPath = dashboardProxyPath(path);
  if (!upstreamPath) {
    return NextResponse.json({ error: "invalid proxy path", code: "bad_request" }, { status: 400 });
  }

  const upstreamURL = rowboatApiURL(upstreamPath, request.nextUrl.searchParams);
  const headers = dashboardProxyHeaders(request.headers);
  headers.set("Authorization", `${auth.session.tokenType} ${auth.session.accessToken}`);

  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  let upstream: Response;
  try {
    upstream = await fetch(upstreamURL, {
      method,
      headers,
      body,
      cache: "no-store",
      signal: request.signal,
    });
  } catch {
    return NextResponse.json(
      {
        title: "rowboat-api is unreachable",
        detail:
          "The dashboard could not reach rowboat-api. In local dev, start the API on port 18080 (docker compose -f docker-compose.rowboat-api.yml up -d).",
        code: "upstream_unavailable",
      },
      { status: 503 },
    );
  }

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

  applyAuthorizedSessionCookies(response, auth, upstream.status);

  return response;
}
