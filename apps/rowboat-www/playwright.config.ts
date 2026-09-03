import { defineConfig, devices } from "@playwright/test";

const port = 4317;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/fake-rowboat-api.mjs",
      url: "http://127.0.0.1:4318/__test/state",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `ROWBOAT_WWW_API_PROXY_URL=http://127.0.0.1:4318 ROWBOAT_WWW_PUBLIC_API_BASE_URL=http://127.0.0.1:4318 ROWBOAT_WWW_PUBLIC_APP_URL=http://127.0.0.1:${port} ROWBOAT_WWW_SESSION_SECRET=playwright-rowboat-www-session-secret-0001 npm run start -- --hostname 127.0.0.1 --port ${port}`,
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
