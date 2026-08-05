import { NextRequest, NextResponse } from "next/server";

import { publicOrigin } from "@/lib/auth/origin";
import { clearAuthCookies } from "@/lib/auth/cookies";
import { safeReturnTo } from "@/lib/auth/pkce";

function logoutResponse(request: NextRequest) {
  // Clear the local session and return to our own site. We intentionally do
  // NOT route through WorkOS's hosted logout: its post-logout redirect is
  // configured in the WorkOS dashboard (currently an off-domain host), so it
  // ignores the return_to we pass and lands users off oppulence.io. Clearing
  // our sealed cookies fully signs the user out of the app; the next sign-in
  // goes through Google with account selection regardless.
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("return_to") || "/");
  const target = new URL(returnTo, publicOrigin(request));
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
