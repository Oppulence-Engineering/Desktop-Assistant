import { NextRequest, NextResponse } from "next/server";

import type { ConnectionStartRequest } from "@/lib/api/generated/client/model";
import { parseRouteParams } from "@/lib/api/routes/parse";
import {
  ConnectorRouteParamsSchema,
  ConnectorStartFormSchema,
} from "@/lib/api/routes/schemas/connectors";
import { startHostedConnector } from "@/lib/bff/connectors/hosted-oauth";
import { isSameOriginBrowserRequest } from "@/lib/bff/same-origin-request";
import { clearAuthCookies } from "@/lib/auth/cookies";
import { publicOrigin } from "@/lib/auth/origin";
import {
  applyAuthorizedSessionCookies,
  getAuthorizedSession,
  type AuthorizedSessionResult,
} from "@/lib/auth/proxy";
import {
  connectorSettingsURL,
  HOSTED_CONNECTOR_CALLBACK_PATH,
  safeAuthorizationURL,
  startOutcome,
  type HostedOAuthOutcome,
} from "@/lib/connectors/hosted-oauth";

type RouteContext = { params: Promise<{ name: string }> };
type AuthorizedSession = Extract<AuthorizedSessionResult, { ok: true }>;

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

function finishOutcome(
  request: NextRequest,
  origin: string,
  auth: AuthorizedSession,
  outcome: HostedOAuthOutcome,
  connector?: string,
  upstreamStatus?: number,
): NextResponse {
  const response = outcomeResponse(request, origin, outcome, connector);
  applyAuthorizedSessionCookies(response, auth, upstreamStatus);
  return response;
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

function requireConnectorAuth(
  request: NextRequest,
  auth: AuthorizedSessionResult,
): AuthorizedSession | NextResponse {
  if (auth.ok) return auth;
  if (auth.response.status === 503) return auth.response;
  return signInResponse(request);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const origin = publicOrigin(request);
  if (!isSameOriginBrowserRequest(request, origin)) {
    return outcomeResponse(request, origin, "error");
  }

  const routeParams = parseRouteParams(await context.params, ConnectorRouteParamsSchema);
  if (!routeParams.success) {
    return outcomeResponse(request, origin, "error");
  }
  const { name } = routeParams.data;

  const authResult = await getAuthorizedSession(request);
  const authOrResponse = requireConnectorAuth(request, authResult);
  if (!("session" in authOrResponse)) return authOrResponse;
  const auth = authOrResponse;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return finishOutcome(request, origin, auth, "error", name);
  }

  const formParsed = ConnectorStartFormSchema.safeParse({
    requested_scope: form
      .getAll("requested_scope")
      .filter((value): value is string => typeof value === "string"),
  });
  if (!formParsed.success) {
    return finishOutcome(request, origin, auth, "scope", name);
  }

  const startRequest: ConnectionStartRequest = {
    redirectTarget: new URL(HOSTED_CONNECTOR_CALLBACK_PATH, origin).toString(),
    requestedScopes: formParsed.data.requested_scope,
  };

  try {
    const result = await startHostedConnector(name, startRequest, auth.session, request.signal);
    if (result.status !== 200) {
      return finishOutcome(request, origin, auth, startOutcome(result), name, result.status);
    }

    const authorizationURL = safeAuthorizationURL(
      result.data.authorization_url || result.data.authorize_url,
    );
    if (!authorizationURL) {
      return finishOutcome(request, origin, auth, "error", name);
    }
    const response = expectsJSON(request)
      ? NextResponse.json({ authorizationUrl: authorizationURL.toString() })
      : NextResponse.redirect(authorizationURL, 303);
    applyAuthorizedSessionCookies(response, auth);
    return response;
  } catch {
    return finishOutcome(request, origin, auth, "error", name);
  }
}
