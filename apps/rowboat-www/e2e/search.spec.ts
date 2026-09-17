import { expect, test } from "@playwright/test";

test("command palette searches semantic mail evidence explicitly", async ({ page }) => {
  await page.goto(`/api/auth/workos/login?return_to=${encodeURIComponent("/app")}`);
  await expect(page.locator("main > header")).toBeVisible();

  await page.getByRole("button", { name: "Ask Oppulence" }).click();
  await page.getByRole("button", { name: /search mail/i }).click();
  await page.getByPlaceholder("Describe the mail evidence to find…").fill("launch promise");

  await expect(page.getByText("Revised launch plan", { exact: true })).toBeVisible();
  await expect(page.getByText(/Ada · commitment · 91%/)).toBeVisible();
});
