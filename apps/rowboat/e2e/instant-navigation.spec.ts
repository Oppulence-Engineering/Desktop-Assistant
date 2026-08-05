import { test, expect } from "@playwright/test";
import { instant } from "@next/playwright";

/**
 * Regression guards for the instant-navigation work (Next 16.3 Cache
 * Components + Partial Prefetching). Assertions inside instant() must hold
 * BEFORE any server data arrives — they pin down what the prerendered shell
 * contains. If someone adds a blocking data read (cookies(), an uncached
 * fetch) to a shared layout, these fail.
 *
 * The assertions are deliberately data-independent so the suite runs against
 * an empty database. A seeded client-navigation test (project card →
 * workflow) is the natural next addition once e2e seeding exists.
 */

test.describe("Instant navigation shells", () => {
  test("/projects serves its loading shell instantly on page load", async ({ page, baseURL }) => {
    await instant(
      page,
      async () => {
        await page.goto("/projects");
        // The segment's loading.tsx spinner is part of the static shell; the
        // page content itself is request-pinned and streams in afterwards.
        await expect(page.locator("[aria-label='Loading']").first()).toBeVisible();
      },
      { baseURL },
    );
    // After streaming, the build-assistant hero replaces the spinner.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Build");
  });

  test("workflow route serves its shell before data resolves", async ({ page, baseURL }) => {
    await instant(
      page,
      async () => {
        // Unknown project id: the shell (sidebar chrome + loading spinner)
        // must render before the server decides this is a 404.
        await page.goto("/projects/000000000000000000000000/workflow");
        await expect(page.locator("a[href='/projects']").first()).toBeVisible();
      },
      { baseURL },
    );
    // After streaming this settles into not-found (seeded DB) or the
    // retryable error alert (no backend) — either way the chrome stays up.
    await expect(page.locator("a[href='/projects']").first()).toBeVisible();
  });
});
