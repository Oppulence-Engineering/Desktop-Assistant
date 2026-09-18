import { expect, test, type Page } from "@playwright/test";

async function authenticate(page: Page, path: string) {
  await page.goto(`/api/auth/workos/login?return_to=${encodeURIComponent(path)}`);
  await expect(page.locator("main > header")).toBeVisible();
}

test("session survives navigation and authenticated auth routes return to the app", async ({
  context,
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();

  await authenticate(page, "/app");
  const sessionCookie = (await context.cookies()).find(
    (cookie) => cookie.name === "rowboat_www_session",
  );
  expect(sessionCookie).toMatchObject({
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: true,
  });

  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveCount(0);

  await page.reload();
  await expect(page.locator("main > header")).toBeVisible();

  const directPage = await context.newPage();
  await directPage.goto("/app/agents");
  await expect(directPage.locator("main > header")).toHaveText("Agents");
  await directPage.close();

  await page.evaluate(() => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/auth/logout?return_to=/sign-in";
    document.body.appendChild(form);
    form.submit();
  });
  await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
});

test("client navigation preserves the document, product shell, and session bootstrap", async ({
  page,
}) => {
  await authenticate(page, "/app");
  await page.evaluate(() => {
    document.documentElement.dataset.navigationDocument = crypto.randomUUID();
    const shell = document.querySelector<HTMLElement>("[data-product-shell]");
    if (shell) shell.dataset.navigationShell = crypto.randomUUID();
  });
  const markers = await page.evaluate(() => ({
    document: document.documentElement.dataset.navigationDocument,
    shell: document.querySelector<HTMLElement>("[data-product-shell]")?.dataset.navigationShell,
  }));
  const documentRequests: string[] = [];
  let sessionRequests = 0;
  page.on("request", (request) => {
    if (request.resourceType() === "document") documentRequests.push(request.url());
    if (new URL(request.url()).pathname === "/api/auth/session") sessionRequests += 1;
  });

  const sidebar = page.locator("nav").filter({ hasText: "Open promises" });
  await sidebar.getByRole("button", { name: "Commitments", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/revenue$/);
  await expect(page.locator("main > header")).toHaveText("Commitments");

  await sidebar.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: /Open promises The commitments/ }).click();
  await expect(page).toHaveURL(/\/app\/report$/);
  await expect(page.locator("main > header")).toHaveText("Open promises");

  await expect
    .poll(() =>
      page.evaluate(() => ({
        document: document.documentElement.dataset.navigationDocument,
        shell: document.querySelector<HTMLElement>("[data-product-shell]")?.dataset.navigationShell,
      })),
    )
    .toEqual(markers);
  expect(documentRequests).toEqual([]);
  expect(sessionRequests).toBe(0);
});

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
