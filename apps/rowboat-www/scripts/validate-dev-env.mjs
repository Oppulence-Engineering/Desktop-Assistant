#!/usr/bin/env node
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const apiUrl = process.env.ROWBOAT_WWW_API_PROXY_URL || "http://localhost:18080";
const port = process.env.ROWBOAT_WWW_PORT || "18082";

const secret =
  process.env.ROWBOAT_WWW_SESSION_SECRET || "dev-only-rowboat-www-session-secret-change-me";

let exitCode = 0;

function writeLine(stream, message) {
  stream.write(`${message}\n`);
}

/**
 * Validate the configured boundary before selecting a transport. Restricting
 * protocols avoids surprising behavior when this contributor tool is given a
 * malformed or non-HTTP proxy URL.
 */
function healthURL(rawApiURL) {
  const url = new URL(`${rawApiURL.replace(/\/+$/, "")}/healthz`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("ROWBOAT_WWW_API_PROXY_URL must use HTTP or HTTPS");
  }
  return url;
}

function requestHealthStatus(url) {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const healthRequest = request(
      url,
      { method: "GET", signal: AbortSignal.timeout(3_000) },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    healthRequest.on("error", reject);
    healthRequest.end();
  });
}

if (secret.length < 32) {
  writeLine(process.stderr, "[dev-env] session secret must be at least 32 characters");
  exitCode = 1;
}

writeLine(process.stdout, "[dev-env] rowboat-www configuration");
writeLine(process.stdout, `  www:  http://localhost:${port}`);
writeLine(process.stdout, `  api:  ${apiUrl}`);
writeLine(
  process.stdout,
  `  secret: ${secret.startsWith("dev-only") ? "(dev fallback)" : "(custom)"}`,
);

try {
  const healthStatus = await requestHealthStatus(healthURL(apiUrl));
  if (healthStatus >= 200 && healthStatus < 300) {
    writeLine(process.stdout, "[dev-env] rowboat-api healthz: ok");
  } else {
    writeLine(process.stderr, `[dev-env] rowboat-api healthz: HTTP ${healthStatus}`);
    exitCode = 1;
  }
} catch {
  writeLine(
    process.stderr,
    "[dev-env] rowboat-api not reachable — start with docker-compose or make api-up",
  );
}

if (exitCode !== 0) {
  writeLine(process.stderr, "[dev-env] fix the issues above before debugging dashboard problems");
}

process.exit(exitCode);
