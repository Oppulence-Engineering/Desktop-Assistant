import { defineConfig } from "@playwright/test";

/**
 * Playwright-Electron smoke/e2e config.
 *
 * These tests drive the **packaged** Electron build via `_electron.launch`
 * (the modern Electron e2e idiom used by Signal and Element Desktop) — not a
 * browser, so no Playwright browser download is needed. Run `npm run package`
 * first, then `npm run test:e2e`. CI sets `ELECTRON_APP_BINARY` to the packaged
 * binary and runs under xvfb.
 */
export default defineConfig({
  testDir: "./e2e",
  // Electron cold-launch + renderer mount can be slow on CI runners.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // One Electron app at a time; launching many in parallel is flaky.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }], ["list"]] : "list",
  use: {
    // Capture a trace on the retry so CI failures are debuggable from the artifact.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
});
