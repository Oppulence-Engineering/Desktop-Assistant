import "server-only";

import type { NextRequest } from "next/server";

/**
 * Public origin of the current request, used to build OAuth redirect URIs.
 *
 * Behind the ingress, `request.nextUrl.origin` reflects the container bind
 * address (e.g. https://0.0.0.0:8080), which WorkOS rejects as an invalid
 * redirect_uri. Resolution order, most authoritative first:
 *   1. ROWBOAT_WWW_PUBLIC_APP_URL — a configured canonical origin. Not
 *      spoofable, always correct; set this in deployed environments.
 *   2. x-forwarded-host / x-forwarded-proto — set by the ingress proxy.
 *   3. request.nextUrl.origin — direct/local requests.
 */
export function publicOrigin(request: NextRequest): string {
  const configured = process.env.ROWBOAT_WWW_PUBLIC_APP_URL;
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const host = forwardedHost.split(",")[0].trim();
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
    if (host) {
      return `${proto}://${host}`;
    }
  }

  return request.nextUrl.origin;
}
