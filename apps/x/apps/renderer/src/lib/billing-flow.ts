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
 * The deployment has no Stripe credentials, so there is no checkout to open.
 * Distinct from a transient failure because no amount of retrying fixes it and
 * telling the user to try again would be a lie. Verified against production on
 * 2026-08-07: POST /v1/billing/checkout-session answers 502 provider_unconfigured.
 */
export class BillingUnavailableError extends Error {
  constructor() {
    super("billing is not configured on this deployment");
    this.name = "BillingUnavailableError";
  }
}

/**
 * Electron serialises a rejected IPC call down to its message, so the typed
 * error raised in the main process does not survive the boundary. The message
 * carries the API's problem code precisely so this check has something stable
 * to read; see BillingRequestError in packages/core/src/billing/billing.ts.
 */
function isUnconfigured(error: unknown): boolean {
  return error instanceof Error && error.message.includes("provider_unconfigured");
}

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

  let checkout: { url?: string };
  try {
    checkout = await window.ipc.invoke("billing:getCheckoutUrl", { plan: ENTRY_PLAN });
  } catch (error) {
    if (isUnconfigured(error)) throw new BillingUnavailableError();
    throw error;
  }
  if (!checkout?.url) throw new Error("billing returned no URL");
  window.open(checkout.url);
}
