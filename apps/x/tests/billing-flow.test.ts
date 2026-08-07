import assert from "node:assert/strict";
import test from "node:test";

import { billingFlowForPlan } from "../apps/renderer/src/lib/billing-flow.ts";

/**
 * The sidebar CTA used to open `${appUrl}?intent=upgrade`, which reached
 * billing in no environment: against the local stack appUrl is the API's own
 * base, so it opened the API root and got a 404 problem document; against
 * production it is https://oppulence.io, which answers 200 but has no handling
 * for `intent` anywhere in rowboat-www.
 */

test("an account with nothing to manage starts a new subscription", () => {
  assert.equal(billingFlowForPlan("free"), "checkout");
  assert.equal(billingFlowForPlan(null), "checkout");
  assert.equal(billingFlowForPlan(undefined), "checkout");
  assert.equal(billingFlowForPlan(""), "checkout");
});

/**
 * The important half. A second checkout session for someone who already pays
 * bills them for a second concurrent subscription instead of moving them up a
 * tier, so every paid plan — including the one the sidebar labels "Upgrade" —
 * has to go through the portal.
 */
test("an existing subscriber is never sent back through checkout", () => {
  for (const plan of ["starter", "pro", "intelligence"]) {
    assert.equal(billingFlowForPlan(plan), "portal", `${plan} must use the portal`);
  }
});

test("an unrecognised plan is treated as paid rather than re-billed", () => {
  assert.equal(billingFlowForPlan("enterprise-2027"), "portal");
});
