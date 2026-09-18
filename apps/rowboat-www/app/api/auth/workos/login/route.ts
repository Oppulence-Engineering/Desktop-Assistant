import { NextRequest, NextResponse } from "next/server";
import { publicOrigin } from "@/lib/auth/origin";

import { setPKCECookie } from "@/lib/auth/cookies";
import { parseSearchParams } from "@/lib/api/routes/parse";
import { WorkOSLoginQuerySchema } from "@/lib/api/routes/schemas/auth";
import { createPKCECookie, safeReturnTo } from "@/lib/auth/pkce";
import { getWorkOSLoginURL } from "@/lib/auth/rowboat-api";

export async function GET(request: NextRequest) {
  const query = parseSearchParams(request.nextUrl.searchParams, WorkOSLoginQuerySchema);
  const returnTo = safeReturnTo(query.success ? query.data.return_to : undefined);
  const pkce = createPKCECookie(returnTo);
  const origin = publicOrigin(request);
  const redirectURI = new URL("/api/auth/callback", origin).toString();

  try {
    const url = await getWorkOSLoginURL({
      redirectURI,
      state: pkce.state,
      codeChallenge: pkce.codeChallenge,
      // Skip the hosted AuthKit picker and go straight to the configured
      // identity provider (e.g. GoogleOAuth). Unset → hosted AuthKit.
      provider: process.env.ROWBOAT_WWW_WORKOS_PROVIDER,
    });
    const response = NextResponse.redirect(url);
    setPKCECookie(response, pkce);
    return response;
  } catch (error) {
    console.error("Failed to create WorkOS sign-in URL", error);
    const fallback = new URL("/sign-in", origin);
    fallback.searchParams.set("error", "sign_in_unavailable");
    fallback.searchParams.set("return_to", returnTo);
    return NextResponse.redirect(fallback);
  }
}
