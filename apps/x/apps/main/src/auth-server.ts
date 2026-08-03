import { createServer, Server, type ServerResponse } from "http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const OAUTH_CALLBACK_PATH = "/oauth/callback";
const OAUTH_LOGO_PATH = "/oauth/assets/logo-only.png";
const OAUTH_INTER_FONT_PATH = "/oauth/assets/inter.woff2";
export const DEFAULT_PORT = 8080;
export const PORT_RANGE_SIZE = 10;

type OAuthPageState = { kind: "authenticating" } | { kind: "error"; error: string };

interface OAuthAsset {
  body: Buffer;
  contentType: string;
}

const assetCache = new Map<string, OAuthAsset>();
const DIAGRAM_BAR_HEIGHTS = [
  46, 56, 66, 74, 82, 88, 92, 96, 98, 100, 100, 98, 94, 90, 84, 76, 68, 58, 48,
] as const;

/** Escape HTML special characters to prevent XSS. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderWelcomeDiagram(): string {
  const bars = DIAGRAM_BAR_HEIGHTS.map(
    (height, index) =>
      `<span class="diagram__bar" style="--bar-height:${height}%;--bar-delay:${index * -0.09}s"></span>`,
  ).join("");

  return `
    <div class="diagram" aria-hidden="true">
      <div class="diagram__bars">${bars}</div>
      <div class="diagram__cutout"></div>
    </div>
  `;
}

function renderOAuthPage(state: OAuthPageState): string {
  const authenticating = state.kind === "authenticating";
  const title = authenticating ? "Authenticating…" : "Sign-in needs your attention.";
  const panelTitle = authenticating ? "Finishing secure sign-in" : "Sign-in could not be completed";
  const panelDescription = authenticating
    ? "Oppulence is verifying your session. This window will close automatically when it is safe to return."
    : "Oppulence could not verify this sign-in. Return to the app and try again.";
  const statusLabel = authenticating ? "Authenticating…" : "Authentication interrupted";
  const statusDetail = authenticating
    ? "Your workspace is being restored."
    : `Error: ${escapeHtml(state.error)}`;
  const pageTitle = authenticating
    ? "Authenticating with Oppulence"
    : "Oppulence sign-in interrupted";

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'none'; img-src 'self'; font-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
        />
        <title>${pageTitle}</title>
        <style>
          @font-face {
            font-family: "Inter";
            src: url("${OAUTH_INTER_FONT_PATH}") format("woff2");
            font-style: normal;
            font-weight: 100 900;
            font-display: swap;
          }

          :root {
            color-scheme: dark;
            font-family: "Inter", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-synthesis: none;
            letter-spacing: -0.15px;
          }

          * { box-sizing: border-box; }

          html, body { min-height: 100%; }

          body {
            margin: 0;
            min-width: 320px;
            min-height: 100svh;
            overflow-x: hidden;
            background: #09090b;
            color: #ffffff;
            -webkit-font-smoothing: antialiased;
            text-rendering: geometricPrecision;
          }

          .auth-shell {
            display: grid;
            min-height: 100svh;
            grid-template-columns: minmax(0, 1fr) 390px;
            overflow: hidden;
            background: #09090b;
          }

          .hero {
            position: relative;
            display: flex;
            min-width: 0;
            min-height: 520px;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            padding: 56px 24px;
          }

          .hero::before {
            position: absolute;
            inset: 0;
            background-image:
              radial-gradient(circle, rgb(255 255 255 / 7%) 0.55px, transparent 0.7px),
              radial-gradient(circle at 52% 48%, rgb(255 255 255 / 5%), transparent 38%),
              linear-gradient(to bottom, rgb(255 255 255 / 2%), transparent 40%, rgb(255 255 255 / 2%));
            background-size: 4px 4px, 100% 100%, 100% 100%;
            content: "";
            opacity: 0.62;
          }

          .hero::after {
            position: absolute;
            inset: 0;
            background:
              radial-gradient(circle at 50% 46%, transparent 0%, transparent 22%, rgb(9 9 11 / 28%) 58%, rgb(9 9 11 / 74%) 100%),
              linear-gradient(to right, transparent 0%, rgb(255 255 255 / 2%) 50%, transparent 100%);
            content: "";
          }

          .brand {
            position: absolute;
            z-index: 2;
            top: 28px;
            left: 28px;
            display: flex;
            align-items: center;
            gap: 12px;
            color: rgb(255 255 255 / 86%);
            font-size: 14px;
            font-weight: 500;
          }

          .brand__mark {
            display: flex;
            width: 36px;
            height: 36px;
            align-items: center;
            justify-content: center;
            border: 1px solid rgb(255 255 255 / 14%);
            background: rgb(255 255 255 / 3%);
          }

          .brand__mark img {
            width: 20px;
            height: 20px;
            filter: invert(1);
          }

          .hero__content {
            position: relative;
            z-index: 2;
            width: min(100%, 560px);
            text-align: center;
            animation: content-enter 420ms ease-out both;
          }

          .hero__content h1 {
            margin: 0;
            color: #ffffff;
            font-size: 24px;
            font-weight: 600;
            line-height: 1.08;
            text-wrap: balance;
          }

          .hero__content p {
            width: min(100%, 470px);
            margin: 20px auto 0;
            color: rgb(255 255 255 / 48%);
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 12px;
            line-height: 24px;
          }

          .chips {
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 8px;
            margin-top: 16px;
          }

          .chip {
            border: 1px solid rgb(255 255 255 / 18%);
            padding: 4px 8px;
            color: rgb(255 255 255 / 62%);
            font-size: 12px;
            font-weight: 500;
          }

          .diagram {
            position: absolute;
            z-index: 1;
            top: 50%;
            left: 50%;
            width: min(640px, 78vw);
            height: min(440px, 58vh);
            opacity: 0.94;
            transform: translate(-50%, -50%);
          }

          .diagram::before {
            position: absolute;
            inset: 7% 5%;
            border-radius: 999px;
            background: radial-gradient(circle at 50% 50%, rgb(255 255 255 / 13%), transparent 56%);
            content: "";
            filter: blur(28px);
            opacity: 0.42;
            animation: diagram-breathe 8s ease-in-out infinite;
          }

          .diagram__bars {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            clip-path: ellipse(49% 43% at 50% 50%);
            mask-image: linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%);
          }

          .diagram__bar {
            display: block;
            width: 11px;
            min-height: 108px;
            height: var(--bar-height);
            border-radius: 999px;
            background: linear-gradient(to bottom, transparent 0%, rgb(255 255 255 / 12%) 12%, rgb(255 255 255 / 34%) 50%, rgb(255 255 255 / 12%) 88%, transparent 100%);
            box-shadow: inset 0 0 1px rgb(255 255 255 / 30%);
            opacity: 0.56;
            transform-origin: center;
            animation: diagram-wave 5.2s cubic-bezier(0.16, 1, 0.3, 1) infinite;
            animation-delay: var(--bar-delay);
          }

          .diagram__cutout {
            position: absolute;
            top: 50%;
            left: 50%;
            width: min(156px, 22vw);
            height: min(178px, 25vw);
            border-radius: 50%;
            background: radial-gradient(circle at 50% 46%, rgb(255 255 255 / 5%), transparent 0 34%, rgb(9 9 11 / 88%) 35%), #09090b;
            box-shadow: 0 0 0 18px rgb(9 9 11 / 72%), 0 0 62px rgb(0 0 0 / 56%);
            transform: translate(-50%, -50%);
          }

          .panel {
            position: relative;
            z-index: 3;
            display: flex;
            align-items: center;
            min-height: 0;
            padding: 40px;
            border-left: 1px solid rgb(255 255 255 / 8%);
            background: #0d0d11;
            box-shadow: -28px 0 80px rgb(0 0 0 / 24%);
          }

          .panel__content {
            width: 100%;
            max-width: 300px;
            margin: 0 auto;
            animation: content-enter 420ms 80ms ease-out both;
          }

          .panel h2 {
            margin: 0;
            color: #ffffff;
            font-size: 14px;
            font-weight: 600;
            line-height: 20px;
          }

          .panel__description {
            margin: 8px 0 0;
            color: rgb(255 255 255 / 52%);
            font-size: 13px;
            line-height: 20px;
          }

          .status-card {
            margin-top: 28px;
            border: 1px solid ${authenticating ? "rgb(255 255 255 / 14%)" : "rgb(248 113 113 / 30%)"};
            background: ${authenticating ? "rgb(255 255 255 / 5.5%)" : "rgb(248 113 113 / 8%)"};
          }

          .status-card__row {
            display: flex;
            min-height: 44px;
            align-items: center;
            gap: 10px;
            padding: 11px 12px;
          }

          .status-card__row img {
            width: 16px;
            height: 16px;
            flex: none;
            filter: invert(1);
            opacity: 0.82;
          }

          .status-card__label {
            min-width: 0;
            flex: 1;
            color: ${authenticating ? "rgb(255 255 255 / 82%)" : "rgb(254 202 202 / 92%)"};
            font-size: 13px;
            font-weight: 500;
          }

          .status-card__bar {
            height: 1px;
            overflow: hidden;
            background: rgb(255 255 255 / 7%);
          }

          .status-card__bar::after {
            display: block;
            width: 42%;
            height: 100%;
            background: rgb(255 255 255 / 66%);
            content: "";
            animation: progress 1.45s ease-in-out infinite;
          }

          .notice {
            margin: 10px 0 0;
            padding: 12px;
            border: 1px solid ${authenticating ? "rgb(255 255 255 / 8%)" : "rgb(248 113 113 / 18%)"};
            background: ${authenticating ? "rgb(255 255 255 / 3.5%)" : "rgb(248 113 113 / 6%)"};
            color: ${authenticating ? "rgb(255 255 255 / 48%)" : "rgb(254 202 202 / 70%)"};
            font-size: 12px;
            line-height: 20px;
          }

          @keyframes content-enter {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
          }

          @keyframes progress {
            from { transform: translateX(-110%); }
            to { transform: translateX(340%); }
          }

          @keyframes diagram-wave {
            0%, 100% { opacity: 0.38; transform: scaleY(0.92); }
            45% { opacity: 0.76; transform: scaleY(1.08); }
          }

          @keyframes diagram-breathe {
            0%, 100% { opacity: 0.32; transform: scale(0.96); }
            50% { opacity: 0.5; transform: scale(1.04); }
          }

          @media (max-width: 820px) {
            .auth-shell { grid-template-columns: 1fr; }
            .hero { min-height: 48svh; padding: 88px 24px 42px; }
            .panel { min-height: 52svh; padding: 40px 24px; border-top: 1px solid rgb(255 255 255 / 8%); border-left: 0; }
            .diagram { width: min(500px, 96vw); height: 330px; }
            .diagram__bar { width: 9px; min-height: 78px; }
            .diagram__cutout { width: 118px; height: 136px; box-shadow: 0 0 0 14px rgb(9 9 11 / 72%), 0 0 48px rgb(0 0 0 / 56%); }
          }

          @media (prefers-reduced-motion: reduce) {
            .hero__content, .panel__content, .diagram::before, .diagram__bar, .status-card__bar::after {
              animation: none;
            }
            .status-card__bar::after { width: 100%; opacity: 0.5; transform: none; }
          }
        </style>
      </head>
      <body>
        <main class="auth-shell" data-auth-state="${state.kind}">
          <section class="hero">
            <div class="brand">
              <span class="brand__mark"><img src="${OAUTH_LOGO_PATH}" alt="" /></span>
              <span>Oppulence</span>
            </div>
            ${renderWelcomeDiagram()}
            <div class="hero__content">
              <h1>${title}</h1>
              <p>${
                authenticating
                  ? "Securely connecting your account and restoring your Oppulence workspace."
                  : "Your local workspace is safe. Return to Oppulence to restart secure sign-in."
              }</p>
              <div class="chips" aria-label="Connection guarantees">
                <span class="chip">Local data preserved</span>
                <span class="chip">Secure connection</span>
              </div>
            </div>
          </section>

          <aside class="panel">
            <div class="panel__content">
              <h2>${panelTitle}</h2>
              <p class="panel__description">${panelDescription}</p>
              <div class="status-card" role="status" aria-live="polite" aria-busy="${authenticating}">
                <div class="status-card__row">
                  <img src="${OAUTH_LOGO_PATH}" alt="" />
                  <span class="status-card__label">${statusLabel}</span>
                </div>
                ${authenticating ? '<div class="status-card__bar" aria-hidden="true"></div>' : ""}
              </div>
              <p class="notice">${statusDetail}</p>
            </div>
          </aside>
        </main>
        ${authenticating ? "<script>setTimeout(() => window.close(), 2000);</script>" : ""}
      </body>
    </html>
  `;
}

export function renderOAuthSuccessPage(): string {
  return renderOAuthPage({ kind: "authenticating" });
}

export function renderOAuthErrorPage(error: string): string {
  return renderOAuthPage({ kind: "error", error });
}

export interface AuthServerResult {
  server: Server;
  port: number;
}

function rendererAssetRoots(): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(moduleDir, "../renderer/dist"),
    path.resolve(moduleDir, "../../../renderer/dist"),
    path.resolve(moduleDir, "../../renderer/dist"),
  ];
}

async function loadOAuthAsset(pathname: string): Promise<OAuthAsset | null> {
  const cached = assetCache.get(pathname);
  if (cached) return cached;

  for (const root of rendererAssetRoots()) {
    try {
      if (pathname === OAUTH_LOGO_PATH) {
        const asset = {
          body: await readFile(path.join(root, "logo-only.png")),
          contentType: "image/png",
        };
        assetCache.set(pathname, asset);
        return asset;
      }

      if (pathname === OAUTH_INTER_FONT_PATH) {
        const assetsDir = path.join(root, "assets");
        const fileName = (await readdir(assetsDir)).find((name) =>
          /^inter-latin-wght-normal-.*\.woff2$/.test(name),
        );
        if (!fileName) continue;
        const asset = {
          body: await readFile(path.join(assetsDir, fileName)),
          contentType: "font/woff2",
        };
        assetCache.set(pathname, asset);
        return asset;
      }
    } catch {
      // Try the next renderer location. Development and packaged builds place
      // the renderer at different relative paths.
    }
  }

  return null;
}

async function serveOAuthAsset(pathname: string, res: ServerResponse): Promise<void> {
  const asset = await loadOAuthAsset(pathname);
  if (!asset) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  res.writeHead(200, {
    "Cache-Control": "public, max-age=86400, immutable",
    "Content-Type": asset.contentType,
    "Content-Length": asset.body.byteLength,
    "X-Content-Type-Options": "nosniff",
  });
  res.end(asset.body);
}

function tryBindPort(
  port: number,
  onCallback: (callbackUrl: URL) => void | Promise<void>,
): Promise<AuthServerResult> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end("Bad Request");
        return;
      }

      const url = new URL(req.url, `http://localhost:${port}`);

      if (url.pathname === OAUTH_LOGO_PATH || url.pathname === OAUTH_INTER_FONT_PATH) {
        void serveOAuthAsset(url.pathname, res);
        return;
      }

      if (url.pathname === OAUTH_CALLBACK_PATH) {
        const error = url.searchParams.get("error");

        if (error) {
          // ... (ERRORS.md E44) Surface denials/provider errors to the flow
          // immediately so connectProvider can emit a specific failure, instead
          // of leaving it to resolve only via the 2-minute abandoned-flow timeout.
          // Swallow rejections — the callback reports failure via its own channel.
          Promise.resolve(onCallback(url)).catch(() => {});
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
          });
          res.end(renderOAuthErrorPage(error));
          return;
        }

        // Handle callback - pass full URL so params like iss (OpenID Connect) are preserved for token exchange
        onCallback(url);

        // ... (ERRORS.md E50) Stay neutral: the token exchange runs asynchronously
        // after this responds, so we must not assert success — it may still fail.
        // The app surfaces the real outcome while this page communicates progress.
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(renderOAuthSuccessPage());
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    server.listen(port, "localhost", () => {
      resolve({ server, port });
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      server.close();
      if (err.code === "EADDRINUSE" || err.code === "EACCES") {
        // Signal caller to try next port
        reject(Object.assign(new Error(err.code), { code: err.code }));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Create a local HTTP server to handle OAuth callback.
 *
 * Defaults to fixed-port behaviour: only `port` is tried, and a clear error is
 * thrown if it cannot be bound. This is the right behaviour for any provider
 * whose redirect URI is pre-registered (Google BYOK, managed connectors, etc.) — those
 * callers must keep using the exact port they've handed to the provider.
 *
 * Opt into `{ fallback: true }` only when the caller is prepared to use the
 * port returned in `AuthServerResult` (i.e. the redirect URI is built from the
 * actual bound port, not hard-coded). With fallback enabled, scans `port`
 * through `port + PORT_RANGE_SIZE - 1` and binds the first available, handling
 * both EADDRINUSE and EACCES (the latter is common on Windows when
 * Hyper-V/WSL2 reserve the port).
 */
export async function createAuthServer(
  port: number = DEFAULT_PORT,
  onCallback: (callbackUrl: URL) => void | Promise<void>,
  opts: { fallback?: boolean } = {},
): Promise<AuthServerResult> {
  const fallback = opts.fallback === true;
  const limit = fallback ? port + PORT_RANGE_SIZE - 1 : port;

  for (let p = port; p <= limit; p++) {
    try {
      return await tryBindPort(p, onCallback);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (fallback && (code === "EADDRINUSE" || code === "EACCES") && p < limit) {
        console.warn(`[OAuth] Port ${p} unavailable (${code}), trying ${p + 1}…`);
        continue;
      }
      if (!fallback) {
        const reason =
          code === "EACCES" || code === "EADDRINUSE"
            ? `Port ${port} is unavailable (${code}). This port must be free for sign-in to work — close any app using it and try again.`
            : err instanceof Error
              ? err.message
              : String(err);
        throw new Error(reason);
      }
      throw new Error(
        `No available port found in range ${port}–${limit}. Free a port in that range and try again.`,
      );
    }
  }

  throw new Error(`No available port found in range ${port}–${limit}.`);
}
