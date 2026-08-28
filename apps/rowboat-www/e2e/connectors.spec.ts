import { expect, test } from "@playwright/test";

const appOrigin = "http://127.0.0.1:4317";
const fakeAPIOrigin = "http://127.0.0.1:4318";

test.describe.configure({ mode: "serial" });

async function authenticate(page: import("@playwright/test").Page) {
  await page.goto(
    `/api/auth/workos/login?return_to=${encodeURIComponent("/app/settings?settings=connections")}`,
  );
  await expect(page).toHaveURL(/\/app\/settings\?settings=connections/);
}

test.beforeEach(async ({ request }) => {
  await request.get(`${fakeAPIOrigin}/__test/reset`);
});

test("settings Connect completes the authenticated hosted claim and shows active health", async ({
  page,
  request,
}) => {
  await authenticate(page);

  const google = page.getByTestId("connector-google");
  await expect(google.getByText("Not connected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Disabled Connector" })).toBeDisabled();
  await google.getByRole("button", { name: "Connect Google" }).click();

  await expect(
    page.getByText(/Authorization was claimed and the connection is active/),
  ).toBeVisible();
  await expect(google.getByText("Active")).toBeVisible();
  await expect(google.getByText("Healthy")).toBeVisible();
  await expect(google.getByText(/Granted scopes: google:email.read/)).toBeVisible();
  await expect(page).toHaveURL(`${appOrigin}/app/settings?settings=connections`);

  const state = await (await request.get(`${fakeAPIOrigin}/__test/state`)).json();
  expect(state.lastStart).toEqual({
    redirectTarget: `${appOrigin}/api/connectors/oauth/callback`,
    requestedScopes: ["google:email.read"],
  });
  expect(state.consumedTickets).toEqual(["ticket-1"]);
  expect(state.lastClaimAuthorization).toMatch(/^Bearer /);
});

test("callback replay and restart outcomes fail safely without retaining the ticket", async ({
  page,
}) => {
  await authenticate(page);
  await page
    .getByTestId("connector-google")
    .getByRole("button", { name: "Connect Google" })
    .click();
  await expect(page.getByText(/Authorization was claimed/)).toBeVisible();

  await page.goto(
    "/api/connectors/oauth/callback?connector=google&status=success&session=ticket-1",
  );
  await expect(page.getByText(/one-time authorization ticket was already used/)).toBeVisible();
  await expect(page).toHaveURL(`${appOrigin}/app/settings?settings=connections`);

  await page.goto("/api/connectors/oauth/callback?connector=google&status=restart_required");
  await expect(page.getByText(/Authorization needs to restart/)).toBeVisible();
  await expect(page).toHaveURL(`${appOrigin}/app/settings?settings=connections`);
});

test("claim entitlement, scope, expiry, retry, and broker failures show safe outcomes", async ({
  page,
}) => {
  await authenticate(page);

  const cases = [
    ["entitlement-ticket", /workspace entitlement does not allow/],
    ["scope-ticket", /invalid or broader scope set/],
    ["expired-ticket", /authorization ticket expired/],
    ["retry-ticket", /connector broker is busy/],
    ["error-ticket", /Authorization could not be completed/],
  ] as const;
  for (const [ticket, message] of cases) {
    await page.goto(
      `/api/connectors/oauth/callback?connector=google&status=success&session=${ticket}`,
    );
    await expect(page.getByText(message)).toBeVisible();
    await expect(page).toHaveURL(`${appOrigin}/app/settings?settings=connections`);
  }

  await page.goto("/api/connectors/oauth/callback?connector=google&status=error");
  await expect(page.getByText(/Authorization could not be completed/)).toBeVisible();
  await expect(page).toHaveURL(`${appOrigin}/app/settings?settings=connections`);
});

test("anonymous callbacks require a session and do not preserve the one-time ticket", async ({
  request,
}) => {
  const response = await request.get(
    "/api/connectors/oauth/callback?connector=google&status=success&session=secret-ticket",
    { maxRedirects: 0 },
  );
  expect(response.status()).toBe(303);
  expect(response.headers().location).toContain("/sign-in");
  expect(response.headers().location).not.toContain("secret-ticket");
});
