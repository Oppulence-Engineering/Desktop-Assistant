import { NextRequest, NextResponse } from "next/server";
import { publicOrigin } from "@/lib/auth/origin";

import { clearPKCECookie, readPKCECookie, setSessionCookie } from "@/lib/auth/cookies";
import { desktopCallbackTarget } from "@/lib/auth/desktop-callback";
import { parseSearchParams } from "@/lib/api/routes/parse";
import { WorkOSCallbackQuerySchema } from "@/lib/api/routes/schemas/auth";
import { isPKCECookieFresh } from "@/lib/auth/pkce";
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
  const query = parseSearchParams(request.nextUrl.searchParams, WorkOSCallbackQuerySchema);
  if (!query.success) {
    return signInRedirect(request, "invalid_sign_in_state");
  }

  if (query.data.error) {
    return signInRedirect(request, "provider_error");
  }

  const { code, state } = query.data;

  // The desktop app cannot register its loopback redirect URI with WorkOS, so
  // it borrows this one and marks itself in `state`. Bounce the code back to
  // the app, which holds the PKCE verifier and does the exchange itself. This
  // runs before the PKCE cookie check below, which a desktop flow never sets.
  if (code) {
    const desktopTarget = desktopCallbackTarget(state ?? null, code);
    if (desktopTarget) {
      return NextResponse.redirect(desktopTarget);
    }
  }

  const pending = readPKCECookie(request);
  if (!code || !state || !pending || pending.state !== state || !isPKCECookieFresh(pending)) {
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
