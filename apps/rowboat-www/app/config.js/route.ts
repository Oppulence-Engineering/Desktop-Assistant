import { getAuthRuntimeConfig } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

/**
 * Runtime browser config. Previously a static public/config.js hardcoding
 * localhost:8080; now emitted from the server environment so deployed
 * environments advertise their real public API base.
 */
export function GET() {
  const { publicApiBaseUrl } = getAuthRuntimeConfig();
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
