import { execFileSync } from "node:child_process";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";

/**
 * Account deletion through the real product UI and the real stack: browser
 * sign-in through the rowboat-api WorkOS broker (devstack), the Settings →
 * Account sheet, rowboat-api DELETE /v1/me, PostgreSQL, and the devstack
 * Stripe and WorkOS mocks. Run by scripts/account-deletion-e2e.sh.
 *
 * The suite signs in once and keeps one page, like a user who cancels, meets a
 * refusal, and then deletes the account. One sign-in also keeps the suite under
 * the API's per-client sign-in rate limit.
 */

const devstackURL = process.env.STACK_DEVSTACK_URL ?? "http://127.0.0.1:8090";
const fixtureSecret = process.env.DEVSTACK_FIXTURE_SECRET ?? "";
const databaseURL = process.env.DATABASE_URL ?? "";
const subject = process.env.STACK_FIXTURE_SUBJECT ?? "user_web_account_deletion";
const run = Date.now().toString(36);

const DevstackStateSchema = z.object({
  subscriptions: z.record(z.string(), z.object({ customer: z.string(), status: z.string() })),
  cancelledSubscriptions: z.array(z.string()),
  deletedWorkOSUsers: z.array(z.string()),
});

const MeSchema = z.object({
  user: z.object({ id: z.string().regex(/^[0-9a-f-]{36}$/) }),
});

test.describe.configure({ mode: "serial" });

let page: Page;
let userID: string;

/** Runs one SQL statement; values travel as psql variables, never inside the SQL text. */
function sql(statement: string, variables: Record<string, string>): string {
  const args = [databaseURL, "--no-psqlrc", "-At", "-v", "ON_ERROR_STOP=1"];
  for (const [name, value] of Object.entries(variables)) args.push("-v", `${name}=${value}`);
  return execFileSync("psql", args, { encoding: "utf8", input: `${statement}\n` }).trim();
}

function userCount(id: string): number {
  return Number(sql("SELECT count(*) FROM users WHERE id = :'user_id';", { user_id: id }));
}

function linkStripeCustomer(id: string, customer: string) {
  const updated = sql(
    "UPDATE subscriptions SET plan = 'pro', stripe_customer_id = :'customer' WHERE user_subscription = :'user_id' RETURNING id;",
    { customer, user_id: id },
  );
  expect(updated, "the signed-in user has a billing row").not.toBe("");
}

async function devstack(
  request: APIRequestContext,
  method: "GET" | "POST",
  path: string,
  data?: unknown,
): Promise<unknown> {
  const response = await request.fetch(`${devstackURL}${path}`, {
    method,
    data,
    headers: { "X-Devstack-Fixture-Secret": fixtureSecret },
  });
  expect(response.status(), `${method} ${path}`).toBe(200);
  return response.json();
}

async function devstackState(
  request: APIRequestContext,
): Promise<z.infer<typeof DevstackStateSchema>> {
  return DevstackStateSchema.parse(
    await devstack(request, "GET", "/fixture/account-deletion/state"),
  );
}

async function seedSubscription(
  request: APIRequestContext,
  id: string,
  customer: string,
  status: string,
) {
  await devstack(request, "POST", "/fixture/stripe/subscriptions", { id, customer, status });
}

/**
 * Loads GET /v1/me through the web proxy as a page navigation. The session
 * cookie is Secure (production build); a real navigation sends it to 127.0.0.1,
 * but Playwright's separate request client would not.
 */
async function proxiedMe(): Promise<{ status: number; body: unknown }> {
  const response = await page.goto("/api/rowboat/v1/me");
  expect(response, "GET /v1/me navigation").not.toBeNull();
  let body: unknown = null;
  try {
    body = await response?.json();
  } catch {
    body = null;
  }
  return { status: response?.status() ?? 0, body };
}

async function openSettings() {
  await page.goto("/app/settings");
  await expect(page).toHaveURL(/\/app\/settings/);
}

async function openDeleteSheet() {
  await openSettings();
  const accountNav = page
    .getByRole("button", { name: "Account", exact: true })
    .or(page.getByRole("button", { name: /^Account\s+Manage your identity/ }))
    .first();
  await accountNav.click();
  await expect(
    page.getByText("Manage your identity, organization, plan, and current browser session."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function confirmDeletion() {
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Permanently delete account" }).click();
}

test.beforeAll(async ({ browser }, testInfo) => {
  expect(fixtureSecret, "DEVSTACK_FIXTURE_SECRET is required").not.toBe("");
  expect(databaseURL, "DATABASE_URL is required").not.toBe("");
  page = await browser.newPage({ baseURL: testInfo.project.use.baseURL });
  await page.goto(`/api/auth/workos/login?return_to=${encodeURIComponent("/app/settings")}`);
  await expect(page).toHaveURL(/\/app\/settings/);
  const me = await proxiedMe();
  expect(me.status, "GET /v1/me through the web proxy").toBe(200);
  userID = MeSchema.parse(me.body).user.id;
});

test.afterAll(async () => {
  await page?.close();
});

test("closing the confirmation sends nothing and keeps the account", async ({ request }) => {
  await openDeleteSheet();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  expect(userCount(userID)).toBe(1);
  expect((await devstackState(request)).deletedWorkOSUsers).not.toContain(subject);
  expect((await proxiedMe()).status).toBe(200);
});

test("a Stripe refusal keeps the account and tells the user why", async ({ request }) => {
  const customer = `cus_web_refused_${run}`;
  const subscription = `sub_web_refused_${run}`;
  await seedSubscription(request, subscription, customer, "active");
  await devstack(request, "POST", "/fixture/stripe/cancel-failure", {
    id: subscription,
    status: 402,
  });
  linkStripeCustomer(userID, customer);

  await openDeleteSheet();
  await confirmDeletion();

  await expect(page.getByRole("alert")).toContainText("We could not cancel your subscription");
  await expect(page).toHaveURL(/\/app\/settings/);
  expect(userCount(userID)).toBe(1);
  const state = await devstackState(request);
  expect(state.subscriptions[subscription]?.status).toBe("active");
  expect(state.deletedWorkOSUsers).not.toContain(subject);
  expect((await proxiedMe()).status, "a refused deletion keeps the session").toBe(200);
});

test("deleting cancels Stripe, deletes the account, and signs the user out", async ({
  request,
}) => {
  const customer = `cus_web_deleted_${run}`;
  const live = {
    [`sub_web_active_${run}`]: "active",
    [`sub_web_trialing_${run}`]: "trialing",
    [`sub_web_past_due_${run}`]: "past_due",
  };
  for (const [id, status] of Object.entries(live)) {
    await seedSubscription(request, id, customer, status);
  }
  await seedSubscription(request, `sub_web_ended_${run}`, customer, "canceled");
  linkStripeCustomer(userID, customer);

  await openDeleteSheet();
  await confirmDeletion();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Your account is deleted")).toBeVisible();
  await expect(dialog.getByText(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)).toBeVisible();
  await dialog.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  expect(userCount(userID)).toBe(0);
  expect(
    Number(
      sql("SELECT count(*) FROM subscriptions WHERE stripe_customer_id = :'customer';", {
        customer,
      }),
    ),
  ).toBe(0);

  const state = await devstackState(request);
  for (const id of Object.keys(live)) {
    expect(state.cancelledSubscriptions).toContain(id);
    expect(state.subscriptions[id]?.status).toBe("canceled");
  }
  expect(state.cancelledSubscriptions).not.toContain(`sub_web_ended_${run}`);
  expect(state.deletedWorkOSUsers).toContain(subject);

  expect((await proxiedMe()).status, "the session is gone after deletion").toBe(401);
});
