import { getAccessToken } from "../auth/tokens.js";
import { API_URL } from "../config/env.js";
import type { BillingInfo, BillingPlan } from "@x/shared/dist/billing.js";

export type BillingCheckoutPlan = "starter" | "pro";

export async function getBillingInfo(): Promise<BillingInfo> {
  const accessToken = await getAccessToken();
  const response = await fetch(`${API_URL}/v1/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Billing API failed: ${response.status}`);
  }
  const body = (await response.json()) as {
    user: {
      id: string;
      email: string;
    };
    billing: {
      plan: BillingPlan | null;
      status: string | null;
      trialExpiresAt: string | null;
      usage: {
        monthly: {
          sanctionedCredits: number;
          usedCredits: number;
          availableCredits: number;
        };
        daily: {
          sanctionedCredits: number;
          usedCredits: number;
          availableCredits: number;
          usageDay: string;
        };
      };
    };
  };
  return {
    userEmail: body.user.email ?? null,
    userId: body.user.id ?? null,
    subscriptionPlan: body.billing.plan,
    subscriptionStatus: body.billing.status,
    trialExpiresAt: body.billing.trialExpiresAt ?? null,
    monthly: body.billing.usage.monthly,
    daily: body.billing.usage.daily,
  };
}

/**
 * Read the API's problem code out of a failed billing response.
 *
 * "Billing API failed: 502" alone cannot be told apart from a network blip, so
 * the UI had to describe every failure as if it were transient. Billing has one
 * genuinely non-transient failure — provider_unconfigured, returned when the
 * deployment has no Stripe credentials — and retrying that forever is not an
 * answer the user can act on.
 */
async function billingProblemCode(response: Response): Promise<string | null> {
  try {
    const problem = (await response.json()) as { code?: unknown };
    return typeof problem.code === "string" ? problem.code : null;
  } catch {
    return null;
  }
}

/** Carries the API's problem code so callers can branch without substring matching. */
export class BillingRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`Billing API failed: ${status}${code ? ` (${code})` : ""}`);
    this.name = "BillingRequestError";
  }
}

async function authedBillingPost<T>(path: string, body?: unknown): Promise<T> {
  const accessToken = await getAccessToken();
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new BillingRequestError(response.status, await billingProblemCode(response));
  }
  return (await response.json()) as T;
}

export async function createBillingCheckoutSession(plan: BillingCheckoutPlan): Promise<string> {
  const result = await authedBillingPost<{ url: string }>("/v1/billing/checkout-session", { plan });
  return result.url;
}

export async function getBillingPortalUrl(): Promise<string> {
  const result = await authedBillingPost<{ url: string }>("/v1/billing/portal-session");
  return result.url;
}

export async function syncBilling(): Promise<void> {
  await authedBillingPost("/v1/billing/sync");
}
