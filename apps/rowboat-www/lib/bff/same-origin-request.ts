import "server-only";

import type { NextRequest } from "next/server";

/**
 * Validates that a mutating browser request originated from this application.
 * Requires a matching Origin when present; otherwise falls back to Referer.
 * Fails closed when neither header proves same-origin provenance.
 */
export function isSameOriginBrowserRequest(request: NextRequest, origin: string): boolean {
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin) return requestOrigin === origin;

  const referer = request.headers.get("referer");
  if (!referer) return false;

  try {
    return new URL(referer).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Allows GET logout only for same-origin navigations. Cross-site top-level GET
 * forms include a foreign Referer; direct POST remains always permitted.
 */
export function isSameOriginNavigation(request: NextRequest, origin: string): boolean {
  if (request.method === "POST") return true;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin" || fetchSite === "same-site") return true;

  return isSameOriginBrowserRequest(request, origin);
}
