import { NextRequest, NextResponse } from "next/server";

import type { ConnectionStartRequest } from "@/lib/api/generated/client/model";
import { clearAuthCookies, setSessionCookie } from "@/lib/auth/cookies";
import { publicOrigin } from "@/lib/auth/origin";
import { getAuthorizedSession } from "@/lib/auth/proxy";
import {
  connectorSettingsURL,
  HOSTED_CONNECTOR_CALLBACK_PATH,
  isConnectorSlug,
  safeAuthorizationURL,
  startOutcome,
  type HostedOAuthOutcome,
} from "@/lib/connectors/hosted-oauth";
import { startHostedConnector } from "@/lib/bff/connectors/hosted-oauth";

type RouteContext = { params: Promise<{ name: string }> };

function expectsJSON(request: NextRequest): boolean {
  return request.headers.get("accept")?.includes("application/json") ?? false;
}

function outcomeStatus(outcome: HostedOAuthOutcome): number {
  if (outcome === "scope") return 400;
  if (outcome === "entitlement") return 403;
  if (outcome === "replay" || outcome === "restart") return 409;
  if (outcome === "expired") return 410;
  if (outcome === "retry") return 429;
  return 502;
}

function outcomeResponse(
  request: NextRequest,
  origin: string,
  outcome: HostedOAuthOutcome,
  connector?: string,
): NextResponse {
  if (expectsJSON(request)) {
    return NextResponse.json({ outcome }, { status: outcomeStatus(outcome) });
  }
  return NextResponse.redirect(connectorSettingsURL(origin, outcome, connector), 303);
}

function signInResponse(request: NextRequest): NextResponse {
  const url = new URL("/api/auth/workos/login", publicOrigin(request));
  url.searchParams.set("return_to", "/app/settings?settings=connections");
  const response = expectsJSON(request)
    ? NextResponse.json({ signInUrl: `${url.pathname}${url.search}` }, { status: 401 })
    : NextResponse.redirect(url, 303);
  clearAuthCookies(response);
  return response;
}

function requestedScopes(form: FormData): string[] | null {
  const scopes = form
    .getAll("requested_scope")
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim());
  if (scopes.some((scope) => !scope || scope.length > 200) || scopes.length > 64) return null;
  return [...new Set(scopes)];
}

export async function POST(request: NextRequest, context: RouteContext) {
  const origin = publicOrigin(request);
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== origin) {
    return outcomeResponse(request, origin, "error");
  }

  const { name } = await context.params;
  if (!isConnectorSlug(name)) {
    return outcomeResponse(request, origin, "error");
  }

  const auth = await getAuthorizedSession(request);
  if (!auth.ok) return signInResponse(request);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return outcomeResponse(request, origin, "error", name);
  }
  const scopes = requestedScopes(form);
  if (!scopes) {
    return outcomeResponse(request, origin, "scope", name);
  }

  const startRequest: ConnectionStartRequest = {
    redirectTarget: new URL(HOSTED_CONNECTOR_CALLBACK_PATH, origin).toString(),
    requestedScopes: scopes,
  };

  try {
    const result = await startHostedConnector(name, startRequest, auth.session, request.signal);
    if (result.status !== 200) {
      const response = outcomeResponse(request, origin, startOutcome(result), name);
      if (result.status === 401) clearAuthCookies(response);
      else if (auth.refreshed) setSessionCookie(response, auth.refreshed);
      return response;
    }

    const authorizationURL = safeAuthorizationURL(
      result.data.authorization_url || result.data.authorize_url,
    );
    if (!authorizationURL) {
      return outcomeResponse(request, origin, "error", name);
    }
    const response = expectsJSON(request)
      ? NextResponse.json({ authorizationUrl: authorizationURL.toString() })
      : NextResponse.redirect(authorizationURL, 303);
    if (auth.refreshed) setSessionCookie(response, auth.refreshed);
    return response;
  } catch {
    return outcomeResponse(request, origin, "error", name);
  }
}
