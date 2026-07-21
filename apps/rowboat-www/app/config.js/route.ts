export const dynamic = "force-dynamic";

/**
 * Runtime browser config. Reads the public API base straight from the
 * environment (same fallback chain as lib/auth/config) without invoking the
 * full auth-config schema — that validation requires the session secret and
 * must not be able to turn this public, unauthenticated asset into a 500.
 */
export function GET() {
  const publicApiBaseUrl =
    process.env.ROWBOAT_WWW_PUBLIC_API_BASE_URL ||
    process.env.ROWBOATX_PUBLIC_API_BASE_URL ||
    process.env.ROWBOAT_WWW_API_PROXY_URL ||
    process.env.ROWBOATX_API_PROXY_URL ||
    process.env.ROWBOATX_API_BASE_URL ||
    "http://localhost:8080";
  const body =
    "window.config = window.config || {};\n" +
    `window.config.apiBase = window.config.apiBase || ${JSON.stringify(publicApiBaseUrl)};\n`;
  return new Response(body, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
