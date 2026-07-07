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

export function renderOAuthSuccessPage(): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Return to Solomon AI</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          .shell { max-width: 520px; margin: 0 auto; }
          .eyebrow { color: #64748b; font-size: 14px; }
          .status { color: #047857; }
        </style>
      </head>
      <body>
        <main class="shell">
          <p class="eyebrow">Solomon AI</p>
          <h1 class="status">Connected to Solomon AI</h1>
          <p>Your AI coworker, with memory</p>
          <p>Private · on your machine</p>
          <p>Return to Solomon AI.</p>
        </main>
        <script>setTimeout(() => window.close(), 2000);</script>
      </body>
    </html>
  `;
}

export function renderOAuthErrorPage(error: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Return to Solomon AI</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          .shell { max-width: 520px; margin: 0 auto; }
          .eyebrow { color: #64748b; font-size: 14px; }
          .error { color: #b91c1c; }
        </style>
      </head>
      <body>
        <main class="shell">
          <p class="eyebrow">Solomon AI</p>
          <h1 class="error">Sign-in could not be completed</h1>
          <p>Your AI coworker, with memory</p>
          <p>Private · on your machine</p>
          <p>Error: ${escapeHtml(error)}</p>
          <p>Return to Solomon AI.</p>
        </main>
        <script>setTimeout(() => window.close(), 3000);</script>
      </body>
    </html>
  `;
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
          // ... (ERRORS.md E44) Surface denials/provider errors to the flow
          // immediately so connectProvider can emit a specific failure, instead
          // of leaving it to resolve only via the 2-minute abandoned-flow timeout.
          // Swallow rejections — the callback reports failure via its own channel.
          Promise.resolve(onCallback(url)).catch(() => {});
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(renderOAuthErrorPage(error));
          return;
        }

        // Handle callback - pass full URL so params like iss (OpenID Connect) are preserved for token exchange
        onCallback(url);

        // ... (ERRORS.md E50) Stay neutral: the token exchange runs asynchronously
        // after this responds, so we must not assert "Authorization Successful" —
        // it may still fail. The app surfaces the real outcome.
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

  // Unreachable — loop always returns or throws — but satisfies TypeScript
  throw new Error(`No available port found in range ${port}–${limit}.`);
}
