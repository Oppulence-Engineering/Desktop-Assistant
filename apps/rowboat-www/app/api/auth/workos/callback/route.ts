import { NextRequest, NextResponse } from "next/server";
import { publicOrigin } from "@/lib/auth/origin";

import { clearPKCECookie, readPKCECookie, setSessionCookie } from "@/lib/auth/cookies";
import { exchangeWorkOSCode, sessionFromTokenBundle } from "@/lib/auth/rowboat-api";

type PublicSignInError = "provider_error" | "invalid_sign_in_state" | "sign_in_failed";

function signInRedirect(request: NextRequest, error: PublicSignInError) {
  const url = new URL("/sign-in", publicOrigin(request));
  switch (error) {
    case "provider_error":
      url.searchParams.set("error", "provider_error");
      break;
    case "invalid_sign_in_state":
      url.searchParams.set("error", "invalid_sign_in_state");
      break;
    case "sign_in_failed":
      url.searchParams.set("error", "sign_in_failed");
      break;
  }
  const response = NextResponse.redirect(url);
  clearPKCECookie(response);
  return response;
}

export async function GET(request: NextRequest) {
  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) {
    return signInRedirect(request, "provider_error");
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const pending = readPKCECookie(request);
  if (!code || !state || !pending || pending.state !== state) {
    return signInRedirect(request, "invalid_sign_in_state");
  }

  try {
    const bundle = await exchangeWorkOSCode({ code, codeVerifier: pending.codeVerifier });
    const response = NextResponse.redirect(new URL(pending.returnTo, publicOrigin(request)));
    setSessionCookie(response, sessionFromTokenBundle(bundle));
    clearPKCECookie(response);
    return response;
  } catch {
    return signInRedirect(request, "sign_in_failed");
  }
}
