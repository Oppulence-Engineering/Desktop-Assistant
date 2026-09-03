import { NextRequest, NextResponse } from "next/server";

import type { ConnectionClaimRequest } from "@/lib/api/generated/client/model";
import { clearAuthCookies, setSessionCookie } from "@/lib/auth/cookies";
import { publicOrigin } from "@/lib/auth/origin";
import { getAuthorizedSession } from "@/lib/auth/proxy";
import {
  callbackStatusOutcome,
  claimOutcome,
  connectorSettingsURL,
  isConnectorSlug,
} from "@/lib/connectors/hosted-oauth";
import { claimHostedConnector } from "@/lib/bff/connectors/hosted-oauth";

function unauthenticatedResponse(request: NextRequest, connector?: string): NextResponse {
  const origin = publicOrigin(request);
  const login = new URL("/sign-in", origin);
  login.searchParams.set(
    "return_to",
    connectorSettingsURL(origin, "restart", connector).pathname +
      connectorSettingsURL(origin, "restart", connector).search,
  );
  const response = NextResponse.redirect(login, 303);
  clearAuthCookies(response);
  return response;
}

export async function GET(request: NextRequest) {
  const origin = publicOrigin(request);
  const connector = request.nextUrl.searchParams.get("connector") || "";
  if (!isConnectorSlug(connector)) {
    return NextResponse.redirect(connectorSettingsURL(origin, "error"), 303);
  }

  const auth = await getAuthorizedSession(request);
  if (!auth.ok) return unauthenticatedResponse(request, connector);

  const callbackOutcome = callbackStatusOutcome(request.nextUrl.searchParams.get("status"));
  if (callbackOutcome) {
    const response = NextResponse.redirect(
      connectorSettingsURL(origin, callbackOutcome, connector),
      303,
    );
    if (auth.refreshed) setSessionCookie(response, auth.refreshed);
    return response;
  }

  const state = request.nextUrl.searchParams.get("session");
  if (request.nextUrl.searchParams.get("status") !== "success" || !state || state.length > 2048) {
    return NextResponse.redirect(connectorSettingsURL(origin, "error", connector), 303);
  }

  const claimRequest: ConnectionClaimRequest = { state };
  try {
    const result = await claimHostedConnector(
      connector,
      claimRequest,
      auth.session,
      request.signal,
    );
    const response = NextResponse.redirect(
      connectorSettingsURL(origin, claimOutcome(result), connector),
      303,
    );
    if (result.status === 401) clearAuthCookies(response);
    else if (auth.refreshed) setSessionCookie(response, auth.refreshed);
    return response;
  } catch {
    return NextResponse.redirect(connectorSettingsURL(origin, "error", connector), 303);
  }
}
