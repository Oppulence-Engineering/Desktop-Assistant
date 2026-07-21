import { NextRequest, NextResponse } from "next/server";
import { publicOrigin } from "@/lib/auth/origin";

import { clearPKCECookie, readPKCECookie, setSessionCookie } from "@/lib/auth/cookies";
import { exchangeWorkOSCode, sessionFromTokenBundle } from "@/lib/auth/rowboat-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function signInRedirect(request: NextRequest, error: string) {
  const url = new URL("/sign-in", publicOrigin(request));
  url.searchParams.set("error", error);
  const response = NextResponse.redirect(url);
  clearPKCECookie(response);
  return response;
}

export async function GET(request: NextRequest) {
  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) {
    return signInRedirect(request, providerError);
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const pending = readPKCECookie(request);
  if (!code || !state || !pending || pending.state !== state) {
    return signInRedirect(request, "invalid sign-in state");
  }

  try {
    const bundle = await exchangeWorkOSCode({ code, codeVerifier: pending.codeVerifier });
    const response = NextResponse.redirect(new URL(pending.returnTo, publicOrigin(request)));
    setSessionCookie(response, sessionFromTokenBundle(bundle));
    clearPKCECookie(response);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "could not complete sign-in";
    return signInRedirect(request, message);
  }
}
