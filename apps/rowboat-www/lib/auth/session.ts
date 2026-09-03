import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { readSessionCookieValue, SESSION_COOKIE } from "@/lib/auth/cookies";
import { safeReturnTo } from "@/lib/auth/pkce";
import type { DashboardSessionCookie } from "@/lib/auth/schemas";

/**
 * Server-side security boundary for protected App Router segments.
 *
 * Client session hydration can still refresh user-facing data, but a protected
 * page is never rendered into the client graph without a valid sealed cookie.
 */
export async function requireSession(returnTo = "/app"): Promise<DashboardSessionCookie> {
  await connection();
  const cookieStore = await cookies();
  const session = readSessionCookieValue(cookieStore.get(SESSION_COOKIE)?.value);

  if (!session || session.expiresAt <= Math.floor(Date.now() / 1000)) {
    const safeTarget = safeReturnTo(returnTo);
    redirect(`/api/auth/workos/login?return_to=${encodeURIComponent(safeTarget)}`);
  }

  return session;
}
