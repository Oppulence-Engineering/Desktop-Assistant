#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const apiUrl = process.env.ROWBOAT_WWW_API_PROXY_URL || "http://localhost:18080";
const port = process.env.ROWBOAT_WWW_PORT || "18082";

const secret =
  process.env.ROWBOAT_WWW_SESSION_SECRET || "dev-only-rowboat-www-session-secret-change-me";

let exitCode = 0;

if (secret.length < 32) {
  console.error("[dev-env] ROWBOAT_WWW_SESSION_SECRET must be at least 32 characters");
  exitCode = 1;
}

console.log("[dev-env] rowboat-www configuration");
console.log(`  www:  http://localhost:${port}`);
console.log(`  api:  ${apiUrl}`);
console.log(`  secret: ${secret.startsWith("dev-only") ? "(dev fallback)" : "(custom)"}`);

try {
  const health = await fetch(`${apiUrl.replace(/\/+$/, "")}/healthz`, {
    signal: AbortSignal.timeout(3_000),
  });
  if (health.ok) {
    console.log("[dev-env] rowboat-api healthz: ok");
  } else {
    console.warn(`[dev-env] rowboat-api healthz: HTTP ${health.status}`);
    exitCode = 1;
  }
} catch (error) {
  console.warn(
    `[dev-env] rowboat-api not reachable at ${apiUrl} — start with docker-compose or make api-up`,
  );
  console.warn(`          ${error instanceof Error ? error.message : error}`);
}

if (exitCode !== 0) {
  console.warn("[dev-env] fix the issues above before debugging dashboard auth/API problems");
}

process.exit(exitCode);
