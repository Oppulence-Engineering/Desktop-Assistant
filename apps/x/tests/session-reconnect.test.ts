import assert from "node:assert/strict";
import test from "node:test";

import { shouldShowSessionReconnect } from "../apps/renderer/src/lib/session-reconnect.ts";

const expiredSession = {
  isLoading: false,
  signedIn: true,
  authReason: "reconnect_required" as const,
  billingErrorReason: null,
  deferred: false,
};

test("prompts when a signed-in session requires reconnect", () => {
  assert.equal(shouldShowSessionReconnect(expiredSession), true);
});

test("lets the user defer reconnect and keep working locally", () => {
  assert.equal(shouldShowSessionReconnect({ ...expiredSession, deferred: true }), false);
});

test("also prompts for a billing auth failure", () => {
  assert.equal(
    shouldShowSessionReconnect({
      ...expiredSession,
      authReason: null,
      billingErrorReason: "auth_unavailable",
    }),
    true,
  );
});

test("does not interrupt loading or signed-out onboarding", () => {
  assert.equal(shouldShowSessionReconnect({ ...expiredSession, isLoading: true }), false);
  assert.equal(shouldShowSessionReconnect({ ...expiredSession, signedIn: false }), false);
});
