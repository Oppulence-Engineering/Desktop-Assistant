import type { BillingPlan } from "@x/shared/billing";
import { isSignedIn } from "../account/account.js";
import { getBillingInfo } from "./billing.js";

/**
 * Plans that are a paid subscription. `free` is not one; `intelligence` is
 * (RFC 039 prices it as a separate tier, not a higher `pro`).
 */
const PAID_PLANS: ReadonlySet<string> = new Set<BillingPlan>(["starter", "pro", "intelligence"]);

/**
 * Subscription states that count as paying.
 *
 * `trialing` is included: a trial on a paid plan is how a paid plan starts, and
 * gating the feature during it would demo the product without the thing being
 * evaluated. `past_due` and `canceled` are excluded — a failing card is not a
 * paid subscription, and the whole point of this gate is that unpaid usage
 * costs us inference. Adding a grace period is one entry in this set.
 */
const PAYING_STATUSES: ReadonlySet<string> = new Set(["active", "trialing"]);

/** Whether a plan/status pair is a live paid subscription. */
export function isPaidSubscription(
  plan: BillingPlan | null,
  status: string | null,
): boolean {
  if (plan === null || !PAID_PLANS.has(plan)) return false;
  // A null status predates the field; treat the plan as authoritative rather
  // than locking out a paying customer over a missing string.
  if (status === null) return true;
  return PAYING_STATUSES.has(status);
}

/**
 * Last successful answer, so a network blip does not silently switch a paid
 * customer's feature off. Deliberately short-lived: the failure mode on the
 * other side is unpaid inference, and that is the one that costs money.
 */
let lastKnown: { paid: boolean; atMs: number } | null = null;

/** How long a cached answer survives once billing stops responding. */
export const ENTITLEMENT_GRACE_MS = 24 * 60 * 60 * 1000;

/** Reset the cached answer. Tests only. */
export function resetEntitlementCache(): void {
  lastKnown = null;
}

/**
 * Whether this user has a live paid subscription.
 *
 * Fails closed. If billing cannot be reached and there is no recent answer,
 * this reports false, because the caller is about to spend our money on the
 * user's behalf and "we could not check" is not permission to do that. A user
 * who is not signed in has no subscription, and getBillingInfo throwing is the
 * normal way that presents.
 */
export async function hasPaidSubscription(nowMs: number = Date.now()): Promise<boolean> {
  try {
    const info = await getBillingInfo();
    const paid = isPaidSubscription(info.subscriptionPlan, info.subscriptionStatus);
    lastKnown = { paid, atMs: nowMs };
    return paid;
  } catch {
    if (lastKnown && nowMs - lastKnown.atMs < ENTITLEMENT_GRACE_MS) return lastKnown.paid;
    return false;
  }
}

/**
 * Whether email labeling may run.
 *
 * The gate exists because labeling is the most expensive thing the app does on
 * a user's behalf — an agent run over every synced email — and unpaid use of it
 * costs us money. That reasoning only holds when the tokens are ours.
 *
 * Signed-in runs route through the product gateway regardless of what
 * models.json says (getDefaultModelAndProvider: "routing stays on the product
 * gateway regardless"), so we pay and a paid plan is required. A BYOK install
 * is not signed in and spends the user's own key against their own provider, so
 * gating it would withhold a feature that costs us nothing and that they are
 * already paying for on the other side.
 */
export async function labelingEntitled(nowMs: number = Date.now()): Promise<boolean> {
  if (!(await isSignedIn())) return true;
  return hasPaidSubscription(nowMs);
}
