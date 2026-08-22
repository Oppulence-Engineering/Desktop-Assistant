import { NextRequest, NextResponse } from "next/server";

import { readSessionCookie } from "@/lib/auth/cookies";
import { safeReturnTo } from "@/lib/auth/pkce";

/**
 * Reject anonymous product requests before App Router starts streaming.
 *
 * The protected layout performs the same validation as a defense-in-depth
 * boundary. Keeping this early check in proxy.ts guarantees direct browser and
 * API requests receive a real HTTP redirect instead of an in-stream redirect.
 */
export function proxy(request: NextRequest) {
  const session = readSessionCookie(request);

  if (!session || session.expiresAt <= Math.floor(Date.now() / 1000)) {
    const login = new URL("/api/auth/workos/login", request.url);
    login.searchParams.set(
      "return_to",
      safeReturnTo(`${request.nextUrl.pathname}${request.nextUrl.search}`),
    );
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
