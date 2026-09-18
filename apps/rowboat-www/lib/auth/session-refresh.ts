import "server-only";

import type { NextResponse } from "next/server";

import { clearAuthCookies } from "@/lib/auth/cookies";
import {
  refreshWorkOSSession,
  sessionAccessValid,
  shouldRefreshSession,
} from "@/lib/auth/rowboat-api";
import type { DashboardSessionCookie } from "@/lib/auth/schemas";

export type SessionRefreshResult =
  | { ok: true; session: DashboardSessionCookie; refreshed?: DashboardSessionCookie }
  | { ok: false; response: NextResponse };

type ResolveSessionRefreshOptions = {
  session: DashboardSessionCookie;
  sessionExpiredResponse: () => NextResponse;
  refreshUnavailableResponse: () => NextResponse;
};

/**
 * Proactively refreshes a near-expiry session. Reconnect-required responses
 * clear auth; transient refresh failures keep the current access token when it
 * is still valid so optional dashboard calls can continue.
 */
export async function resolveSessionRefresh({
  session,
  sessionExpiredResponse,
  refreshUnavailableResponse,
}: ResolveSessionRefreshOptions): Promise<
  Extract<SessionRefreshResult, { ok: true }> | Extract<SessionRefreshResult, { ok: false }>
> {
  if (!shouldRefreshSession(session)) {
    return { ok: true, session };
  }

  let refreshed: DashboardSessionCookie | null;
  try {
    refreshed = await refreshWorkOSSession(session);
  } catch {
    if (sessionAccessValid(session)) {
      return { ok: true, session };
    }
    return { ok: false, response: refreshUnavailableResponse() };
  }

  if (!refreshed) {
    const response = sessionExpiredResponse();
    clearAuthCookies(response);
    return { ok: false, response };
  }

  return { ok: true, session: refreshed, refreshed };
}
