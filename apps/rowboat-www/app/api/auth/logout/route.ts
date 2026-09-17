import { NextRequest, NextResponse } from "next/server";

import { parseSearchParams } from "@/lib/api/routes/parse";
import { LogoutQuerySchema } from "@/lib/api/routes/schemas/auth";
import { publicOrigin } from "@/lib/auth/origin";
import { clearAuthCookies } from "@/lib/auth/cookies";
import { safeReturnTo } from "@/lib/auth/pkce";
import { isSameOriginNavigation } from "@/lib/bff/same-origin-request";

function logoutResponse(request: NextRequest) {
  const query = parseSearchParams(request.nextUrl.searchParams, LogoutQuerySchema);
  const returnTo = safeReturnTo(query.success ? query.data.return_to || "/" : "/");
  const target = new URL(returnTo, publicOrigin(request));
  const response = NextResponse.redirect(target);
  clearAuthCookies(response);
  return response;
}

function rejectCrossSiteLogout(): NextResponse {
  return NextResponse.json(
    { error: "logout requires a same-origin request", code: "method_not_allowed" },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export function GET(request: NextRequest) {
  if (!isSameOriginNavigation(request, publicOrigin(request))) {
    return rejectCrossSiteLogout();
  }
  return logoutResponse(request);
}

export function POST(request: NextRequest) {
  return logoutResponse(request);
}
