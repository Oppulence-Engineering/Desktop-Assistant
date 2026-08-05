import { defineConfig } from "@playwright/test";

// Instant-navigation regression tests (see e2e/). They run against `next dev`,
// where the instant() testing API is enabled automatically. To run against a
// production build in CI instead, `next build && next start` with
// experimental.exposeTestingApiInProductionBuild enabled and point baseURL at
// it.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
