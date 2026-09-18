import { expect, test as setup } from "@playwright/test";

const authFile = "e2e/.auth/session.json";

/**
 * Seeds Playwright storage state with a sealed dashboard session so smoke tests
 * skip the WorkOS redirect dance on every spec.
 */
setup("authenticate dashboard session", async ({ page }) => {
  await page.goto("/api/auth/workos/login?return_to=%2Fapp");
  await expect(page.locator("main > header")).toBeVisible();
  await page.context().storageState({ path: authFile });
});
