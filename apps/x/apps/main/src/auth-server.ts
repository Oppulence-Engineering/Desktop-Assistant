import { createServer, Server } from "http";
import { URL } from "url";

const OAUTH_CALLBACK_PATH = "/oauth/callback";
export const DEFAULT_PORT = 8080;
export const PORT_RANGE_SIZE = 10;

/** Escape HTML special characters to prevent XSS */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface OAuthCallbackPageOptions {
  state: "success" | "error";
  title: string;
  heading: string;
  message: string;
  detail?: string;
  closeDelayMs: number;
}

function renderOAuthCallbackPage({
  state,
  title,
  heading,
  message,
  detail,
  closeDelayMs,
}: OAuthCallbackPageOptions): string {
  const isSuccess = state === "success";
  const escapedTitle = escapeHtml(title);
  const escapedHeading = escapeHtml(heading);
  const escapedMessage = escapeHtml(message);
  const escapedDetail = detail ? escapeHtml(detail) : "";
  const statusLabel = isSuccess ? "Connected" : "Needs attention";
  const stepLabel = isSuccess ? "Done" : "Review";
  const statusClass = isSuccess ? "success" : "error";

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapedTitle}</title>
        <style>
          :root {
            color-scheme: light dark;
            --background: #ffffff;
            --foreground: #171717;
            --muted: #737373;
            --panel: #f5f5f5;
            --border: #e5e5e5;
            --success: #16a34a;
            --success-bg: #dcfce7;
            --error: #dc2626;
            --error-bg: #fee2e2;
          }

          @media (prefers-color-scheme: dark) {
            :root {
              --background: #0a0a0a;
              --foreground: #f5f5f5;
              --muted: #a3a3a3;
              --panel: #1f1f1f;
              --border: #333333;
              --success-bg: #052e16;
              --error-bg: #450a0a;
            }
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            min-height: 100vh;
            overflow-x: hidden;
            background: var(--background);
            color: var(--foreground);
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            letter-spacing: 0;
          }

          .auth-shell {
            display: flex;
            min-height: 100vh;
          }

          .brand-rail {
            position: relative;
            display: flex;
            width: 400px;
            flex-shrink: 0;
            flex-direction: column;
            border-right: 1px solid var(--border);
            background:
              radial-gradient(120% 80% at 15% 100%, color-mix(in oklab, var(--foreground) 6%, transparent), transparent 60%),
              var(--panel);
            padding: 40px 36px;
          }

          .brand {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 12px;
            font-size: 18px;
            font-weight: 700;
          }

          .brand-mark {
            display: grid;
            width: 36px;
            height: 36px;
            place-items: center;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: var(--background);
            font-weight: 800;
          }

          .tagline,
          .privacy,
          .step-text,
          .message,
          .closing {
            color: var(--muted);
          }

          .tagline {
            display: inline-flex;
            width: fit-content;
            align-items: center;
            gap: 8px;
            margin-bottom: 42px;
            border: 1px solid var(--border);
            border-radius: 999px;
            background: color-mix(in oklab, var(--background) 70%, var(--panel));
            padding: 5px 12px;
            font-size: 12px;
            font-weight: 600;
          }

          .pulse {
            width: 6px;
            height: 6px;
            border-radius: 999px;
            background: var(--success);
          }

          .steps {
            display: grid;
            gap: 18px;
          }

          .step {
            display: grid;
            grid-template-columns: 30px 1fr;
            gap: 12px;
            align-items: start;
          }

          .step-number {
            display: grid;
            width: 30px;
            height: 30px;
            place-items: center;
            border: 1px solid var(--border);
            border-radius: 999px;
            background: var(--background);
            font-size: 12px;
            font-weight: 700;
          }

          .step.active .step-number {
            border-color: color-mix(in oklab, var(--success) 60%, var(--border));
            background: var(--success-bg);
            color: var(--success);
          }

          .step-title {
            margin: 1px 0 3px;
            font-size: 14px;
            font-weight: 700;
          }

          .step-text {
            margin: 0;
            font-size: 12px;
            line-height: 1.5;
          }

          .rail-spacer {
            flex: 1;
          }

          .privacy {
            font-size: 12px;
          }

          .content {
            display: grid;
            min-width: 0;
            flex: 1;
            place-items: center;
            padding: 48px;
          }

          .panel {
            width: min(100%, 520px);
            max-width: 100%;
            text-align: center;
          }

          .status-icon {
            position: relative;
            display: grid;
            width: 80px;
            height: 80px;
            place-items: center;
            margin: 0 auto 32px;
            border-radius: 999px;
            background: ${isSuccess ? "var(--success-bg)" : "var(--error-bg)"};
            color: ${isSuccess ? "var(--success)" : "var(--error)"};
            font-size: 42px;
            font-weight: 700;
          }

          .status-pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 14px;
            border: 1px solid var(--border);
            border-radius: 999px;
            padding: 5px 12px;
            font-size: 12px;
            font-weight: 700;
          }

          .status-pill.success {
            color: var(--success);
          }

          .status-pill.error {
            color: var(--error);
          }

          h1 {
            max-width: 100%;
            margin: 0 0 12px;
            font-size: 32px;
            line-height: 1.08;
            overflow-wrap: break-word;
          }

          .message {
            max-width: 390px;
            margin: 0 auto 28px;
            font-size: 16px;
            line-height: 1.65;
          }

          .detail {
            margin: 0 auto 28px;
            max-width: 420px;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: var(--panel);
            padding: 12px 14px;
            overflow-wrap: anywhere;
            color: var(--muted);
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
            font-size: 12px;
            text-align: left;
          }

          button {
            min-width: 220px;
            height: 48px;
            border: 0;
            border-radius: 8px;
            background: var(--foreground);
            color: var(--background);
            cursor: pointer;
            font: inherit;
            font-size: 15px;
            font-weight: 700;
          }

          .closing {
            margin-top: 18px;
            font-size: 12px;
          }

          @media (max-width: 820px) {
            .auth-shell {
              display: block;
            }

            .brand-rail {
              width: 100%;
              border-right: 0;
              border-bottom: 1px solid var(--border);
              padding: 22px 24px;
            }

            .steps,
            .privacy {
              display: none;
            }

            .tagline {
              margin-bottom: 0;
            }

            .content {
              min-height: calc(100vh - 116px);
              overflow: hidden;
              padding: 38px 20px;
            }

            h1 {
              max-width: 280px;
              margin-inline: auto;
              font-size: 26px;
              line-height: 1.15;
            }

            .message {
              max-width: 310px;
            }

            button {
              min-width: 0;
              width: min(100%, 280px);
            }
          }
        </style>
      </head>
      <body>
        <main class="auth-shell">
          <aside class="brand-rail" aria-label="Solomon AI sign-in progress">
            <div class="brand">
              <div class="brand-mark" aria-hidden="true">S</div>
              <span>Solomon AI</span>
            </div>
            <div class="tagline"><span class="pulse" aria-hidden="true"></span>Your AI coworker, with memory</div>

            <div class="steps" aria-label="Sign-in steps">
              <div class="step">
                <div class="step-number">1</div>
                <div>
                  <p class="step-title">Welcome</p>
                  <p class="step-text">Sign in with Solomon AI.</p>
                </div>
              </div>
              <div class="step">
                <div class="step-number">2</div>
                <div>
                  <p class="step-title">Authorize</p>
                  <p class="step-text">Approve access in your browser.</p>
                </div>
              </div>
              <div class="step active">
                <div class="step-number">3</div>
                <div>
                  <p class="step-title">${stepLabel}</p>
                  <p class="step-text">Return to the desktop app.</p>
                </div>
              </div>
            </div>

            <div class="rail-spacer"></div>
            <div class="privacy">Private · on your machine</div>
          </aside>

          <section class="content">
            <div class="panel">
              <div class="status-icon" aria-hidden="true">${isSuccess ? "✓" : "!"}</div>
              <div class="status-pill ${statusClass}">${statusLabel}</div>
              <h1>${escapedHeading}</h1>
              <p class="message">${escapedMessage}</p>
              ${escapedDetail ? `<pre class="detail">${escapedDetail}</pre>` : ""}
              <button type="button" onclick="window.close()">Return to Solomon AI</button>
              <p class="closing">This window will close automatically.</p>
            </div>
          </section>
        </main>
        <script>setTimeout(() => window.close(), ${closeDelayMs});</script>
      </body>
    </html>
  `;
}

export function renderOAuthSuccessPage(): string {
  return renderOAuthCallbackPage({
    state: "success",
    title: "Solomon AI Sign In Complete",
    heading: "Connected to Solomon AI",
    message: "You can return to the desktop app to continue onboarding.",
    closeDelayMs: 2500,
  });
}

export function renderOAuthErrorPage(error: string): string {
  return renderOAuthCallbackPage({
    state: "error",
    title: "Solomon AI Sign In Needs Attention",
    heading: "Sign-in could not be completed",
    message: "Return to Solomon AI and try signing in again.",
    detail: error,
    closeDelayMs: 8000,
  });
}

export interface AuthServerResult {
  server: Server;
  port: number;
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

      if (url.pathname === OAUTH_CALLBACK_PATH) {
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(renderOAuthErrorPage(error));
          return;
        }

        // Handle callback - pass full URL so params like iss (OpenID Connect) are preserved for token exchange
        onCallback(url);

        res.writeHead(200, { "Content-Type": "text/html" });
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
 * whose redirect URI is pre-registered (Google BYOK, Composio, etc.) — those
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

  // Unreachable — loop always returns or throws — but satisfies TypeScript
  throw new Error(`No available port found in range ${port}–${limit}.`);
}
