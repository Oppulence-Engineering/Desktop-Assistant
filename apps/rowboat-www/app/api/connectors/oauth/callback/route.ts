import { NextRequest, NextResponse } from "next/server";

import { parseSearchParams } from "@/lib/api/routes/parse";
import { ConnectorSlugSchema } from "@/lib/api/routes/schemas/common";
import { ConnectorOAuthCallbackQuerySchema } from "@/lib/api/routes/schemas/connectors";
import { claimHostedConnector } from "@/lib/bff/connectors/hosted-oauth";
import { clearAuthCookies } from "@/lib/auth/cookies";
import { publicOrigin } from "@/lib/auth/origin";
import {
  applyAuthorizedSessionCookies,
  getAuthorizedSession,
  type AuthorizedSessionResult,
} from "@/lib/auth/proxy";
import {
  callbackStatusOutcome,
  claimOutcome,
  connectorSettingsURL,
} from "@/lib/connectors/hosted-oauth";

type AuthorizedSession = Extract<AuthorizedSessionResult, { ok: true }>;

function unauthenticatedResponse(request: NextRequest, connector?: string): NextResponse {
  const origin = publicOrigin(request);
  const login = new URL("/sign-in", origin);
  const returnTo = connectorSettingsURL(origin, "restart", connector);
  login.searchParams.set("return_to", `${returnTo.pathname}${returnTo.search}`);
  const response = NextResponse.redirect(login, 303);
  clearAuthCookies(response);
  return response;
}

function requireConnectorAuth(
  request: NextRequest,
  auth: AuthorizedSessionResult,
  connector?: string,
): AuthorizedSession | NextResponse {
  if (auth.ok) return auth;
  if (auth.response.status === 503) return auth.response;
  return unauthenticatedResponse(request, connector);
}

function redirectWithSession(
  url: URL,
  auth: AuthorizedSession,
  upstreamStatus?: number,
): NextResponse {
  const response = NextResponse.redirect(url, 303);
  applyAuthorizedSessionCookies(response, auth, upstreamStatus);
  return response;
}

export async function GET(request: NextRequest) {
  const origin = publicOrigin(request);
  const query = parseSearchParams(request.nextUrl.searchParams, ConnectorOAuthCallbackQuerySchema);
  const connector = query.success ? query.data.connector : "";
  if (!ConnectorSlugSchema.safeParse(connector).success) {
    return NextResponse.redirect(connectorSettingsURL(origin, "error"), 303);
  }

  const authResult = await getAuthorizedSession(request);
  const authOrResponse = requireConnectorAuth(request, authResult, connector);
  if (!("session" in authOrResponse)) return authOrResponse;
  const auth = authOrResponse;

  const callbackOutcome = callbackStatusOutcome(query.success ? (query.data.status ?? null) : null);
  if (callbackOutcome) {
    return redirectWithSession(connectorSettingsURL(origin, callbackOutcome, connector), auth);
  }

  const state = query.success ? query.data.session : undefined;
  if (!query.success || query.data.status !== "success" || !state) {
    return redirectWithSession(connectorSettingsURL(origin, "error", connector), auth);
  }

  try {
    const result = await claimHostedConnector(connector, { state }, auth.session, request.signal);
    return redirectWithSession(
      connectorSettingsURL(origin, claimOutcome(result), connector),
      auth,
      result.status,
    );
  } catch {
    return redirectWithSession(connectorSettingsURL(origin, "error", connector), auth);
  }
}
