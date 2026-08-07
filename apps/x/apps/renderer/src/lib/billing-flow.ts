/**
 * The one way to send someone to billing.
 *
 * The sidebar CTA used to hand-build `${appUrl}?intent=upgrade` instead, which
 * did not work in any environment: against the local stack appUrl is the API's
 * own base (http://localhost:18080), so the button opened the API root and got
 * a 404 problem document; against production appUrl is https://oppulence.io,
 * which answers 200 but has no handling for an `intent` parameter anywhere in
 * rowboat-www. Meanwhile /v1/billing/checkout-session — a working Stripe
 * checkout — sat unused behind billing:getCheckoutUrl.
 */

export type BillingFlow = "checkout" | "portal";

/**
 * Someone who already pays must go to the portal, not to checkout: a second
 * checkout session bills them for a second concurrent subscription rather than
 * moving them up a tier. Only an account with nothing to manage starts fresh.
 */
export function billingFlowForPlan(plan: string | null | undefined): BillingFlow {
  if (!plan || plan === "free") return "checkout";
  return "portal";
}

/** The plan a brand-new subscription starts on. */
const ENTRY_PLAN = "starter";

/**
 * Open the right billing destination for the current account. Resolves the plan
 * itself so every caller behaves the same without threading billing state
 * through — the drift between entry points is what produced the dead URL.
 *
 * Throws if no destination could be opened, so callers can surface it.
 */
export async function openBillingFlow(): Promise<void> {
  let plan: string | null = null;
  try {
    const info = await window.ipc.invoke("billing:getInfo", null);
    plan = info?.subscriptionPlan ?? null;
  } catch {
    // Unknown plan: fall through to checkout, which is the safe default for an
    // account we cannot confirm is already subscribed.
  }

  if (billingFlowForPlan(plan) === "portal") {
    try {
      const portal = await window.ipc.invoke("billing:getPortalUrl", null);
      if (portal?.url) {
        window.open(portal.url);
        return;
      }
    } catch {
      // A subscriber with no Stripe customer linked yet (409
      // stripe_customer_missing) has no portal to open; checkout is the only
      // thing that can move them forward.
    }
  }

  const checkout = await window.ipc.invoke("billing:getCheckoutUrl", { plan: ENTRY_PLAN });
  if (!checkout?.url) throw new Error("billing returned no URL");
  window.open(checkout.url);
}
