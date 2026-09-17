import { expect, test, type Page } from "@playwright/test";

async function authenticate(page: Page, path: string) {
  await page.goto(`/api/auth/workos/login?return_to=${encodeURIComponent(path)}`);
  await expect(page.locator("main > header")).toBeVisible();
}

// Every revenue view used to share /app/revenue and both workflow lists shared
// /app/workflows, so Back skipped them and a refresh always reopened the
// default view.
test("views keep their address through Back, Forward, and reload", async ({ page }) => {
  await authenticate(page, "/app/revenue");
  const title = page.locator("main > header");
  const sidebar = page.locator("nav").filter({ hasText: "Open promises" });
  await expect(title).toHaveText("Commitments");

  await sidebar.getByRole("button", { name: "People", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/revenue\?tab=people$/);
  await expect(title).toHaveText("People");

  await page.goBack();
  await expect(page).toHaveURL(/\/app\/revenue$/);
  await expect(title).toHaveText("Commitments");

  await page.goForward();
  await expect(title).toHaveText("People");

  await page.reload();
  await expect(title).toHaveText("People");

  await sidebar.getByRole("button", { name: /^Runs/ }).click();
  await expect(page).toHaveURL(/\/app\/workflows\?focus=runs$/);
  await expect(title).toHaveText("Runs");

  await page.reload();
  await expect(title).toHaveText("Runs");
});

test("an unknown tab opens Commitments instead of an empty view", async ({ page }) => {
  await authenticate(page, "/app/revenue?tab=bogus");
  await expect(page.locator("main > header")).toHaveText("Commitments");
});
