import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { isSessionUsable, readSessionCookieValue, SESSION_COOKIE } from "@/lib/auth/cookies";
import { safeReturnTo } from "@/lib/auth/pkce";
import type { DashboardSessionCookie } from "@/lib/auth/schemas";

/** Resolves the sealed session from the current Server Component request. */
export async function getOptionalSession(): Promise<DashboardSessionCookie | null> {
  await connection();
  const cookieStore = await cookies();
  return readSessionCookieValue(cookieStore.get(SESSION_COOKIE)?.value);
}

/**
 * Server-side security boundary for protected App Router segments.
 *
 * Client session hydration can still refresh user-facing data, but a protected
 * page is never rendered into the client graph without a valid sealed cookie.
 */
export async function requireSession(returnTo = "/app"): Promise<DashboardSessionCookie> {
  const session = await getOptionalSession();

  if (!isSessionUsable(session)) {
    const safeTarget = safeReturnTo(returnTo);
    redirect(`/api/auth/workos/login?return_to=${encodeURIComponent(safeTarget)}`);
  }

  return session;
}
