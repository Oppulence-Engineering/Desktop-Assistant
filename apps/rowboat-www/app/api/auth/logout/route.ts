import { NextRequest, NextResponse } from "next/server";

import { getAuthRuntimeConfig } from "@/lib/auth/config";
import { clearAuthCookies, readSessionCookie } from "@/lib/auth/cookies";
import { safeReturnTo } from "@/lib/auth/pkce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function logoutResponse(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("return_to") || "/");
  const session = readSessionCookie(request);
  const localReturn = new URL(returnTo, request.nextUrl.origin);

  let target = localReturn;
  if (session?.user.sessionId) {
    target = new URL("/user_management/sessions/logout", getAuthRuntimeConfig().workosLogoutBaseUrl);
    target.searchParams.set("session_id", session.user.sessionId);
    target.searchParams.set("return_to", localReturn.toString());
  }

  const response = NextResponse.redirect(target);
  clearAuthCookies(response);
  return response;
}

export function GET(request: NextRequest) {
  return logoutResponse(request);
}

export function POST(request: NextRequest) {
  return logoutResponse(request);
}
