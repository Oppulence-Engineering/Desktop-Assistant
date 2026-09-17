import { expect, test } from "@playwright/test";

test("note templates survive a browser reload through console persistence", async ({ page }) => {
  const destination = "/app/revenue?tab=notes";
  await page.goto(`/api/auth/workos/login?return_to=${encodeURIComponent(destination)}`);
  await expect(page.locator("main > header")).toHaveText("Notes");

  await page.getByRole("tab", { name: /Templates/ }).click();
  await page.getByRole("button", { name: "Create template", exact: true }).click();
  await page.getByRole("textbox", { name: "Template title" }).fill("Renewal review");
  await page
    .getByRole("textbox", { name: "Template body" })
    .fill("Summarize renewal risk and unresolved promises.");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText("Renewal review", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: /Templates/ }).click();
  await expect(page.getByText("Renewal review", { exact: true })).toBeVisible();

  const fixtureState = await (await page.request.get("http://127.0.0.1:4318/__test/state")).json();
  expect(fixtureState.consoleResources).toEqual([
    expect.objectContaining({ kind: "note_template", name: "Renewal review" }),
  ]);
});
