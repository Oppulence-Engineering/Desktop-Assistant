import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * Browser end-to-end run against the real local stack (rowboat-api, devstack,
 * PostgreSQL) instead of e2e/fake-rowboat-api.mjs. scripts/account-deletion-e2e.sh
 * starts the stack, then runs:
 *   npx playwright test --config config/e2e/playwright.stack.config.ts
 */
const appRoot = path.resolve(__dirname, "../..");
const port = Number(process.env.STACK_WWW_PORT ?? 4417);
const apiURL = process.env.STACK_API_URL ?? "http://127.0.0.1:18080";

export default defineConfig({
  testDir: path.join(appRoot, "e2e-stack"),
  outputDir: path.join(appRoot, "test-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 90_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `ROWBOAT_WWW_API_PROXY_URL=${apiURL} ROWBOAT_WWW_PUBLIC_API_BASE_URL=${apiURL} ROWBOAT_WWW_PUBLIC_APP_URL=http://127.0.0.1:${port} ROWBOAT_WWW_SESSION_SECRET=stack-e2e-rowboat-www-session-secret-0001 npm run start -- --hostname 127.0.0.1 --port ${port}`,
    cwd: appRoot,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
