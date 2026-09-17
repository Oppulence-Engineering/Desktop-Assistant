import { expect, test } from "@playwright/test";

test.describe("smoke @smoke", () => {
  test("open promises report renders a completed scan", async ({ page }) => {
    await page.goto("/app/report?scan=scan-e2e-1");
    await expect(page.locator("main > header")).toHaveText("Open promises");
    await expect(page.getByText("We promised")).toBeVisible();
    await expect(page.getByText("Send the revised proposal")).toBeVisible();
    await expect(page.getByRole("button", { name: "Download the report" })).toBeVisible();
  });
});
