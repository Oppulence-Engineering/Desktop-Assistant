import { NextResponse } from "next/server";

import { publicRowboatApiURL } from "@/lib/rowboat-public-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMBEDDED_OPENAPI_PATH = "/api/openapi?source=scalar";
const HTML_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "text/html; charset=utf-8",
};

export async function GET(): Promise<NextResponse> {
  const docsURL = publicRowboatApiURL("/docs");

  try {
    const upstream = await fetch(docsURL, {
      cache: "no-store",
      headers: { Accept: "text/html" },
    });

    if (!upstream.ok) {
      return new NextResponse(fallbackHTML(docsURL.toString()), {
        headers: HTML_HEADERS,
        status: upstream.status,
      });
    }

    const html = (await upstream.text())
      .replaceAll(
        "<title>Solomon AI API Reference</title>",
        "<title>Oppulence API Reference</title>",
      )
      .replaceAll('url: "/openapi.json"', `url: "${EMBEDDED_OPENAPI_PATH}"`);

    return new NextResponse(html, { headers: HTML_HEADERS });
  } catch {
    return new NextResponse(fallbackHTML(docsURL.toString()), {
      headers: HTML_HEADERS,
      status: 502,
    });
  }
}

function fallbackHTML(docsURL: string): string {
  const escapedURL = docsURL
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  return `<!doctype html>
<html lang="en">
  <head>
    <title>Oppulence API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
        background: #fafafa;
        color: #171717;
        font: 14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        display: grid;
        min-height: 100vh;
        place-items: center;
        padding: 32px;
      }
      section {
        max-width: 520px;
        border: 1px solid #dedede;
        border-radius: 8px;
        background: white;
        padding: 24px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.08);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 18px;
      }
      p {
        margin: 0 0 18px;
        color: #5f6b7a;
      }
      a {
        color: #171717;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>API reference unavailable</h1>
        <p>The embedded Scalar reference could not reach the Oppulence API docs endpoint.</p>
        <a href="${escapedURL}" rel="noopener noreferrer" target="_blank">Open the API docs directly</a>
      </section>
    </main>
  </body>
</html>`;
}
