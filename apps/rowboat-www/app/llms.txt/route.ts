import { buildLlmsTxt } from "../(marketing)/seo-theme";

/**
 * Public AEO file. Served as a route so the lander list cannot drift from
 * a checked-in static copy.
 */
export function GET() {
  return new Response(buildLlmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
