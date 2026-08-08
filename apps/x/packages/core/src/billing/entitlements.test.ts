import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Labeling is the most expensive thing the app does on a user's behalf — an
 * agent run over every synced email, billed to us in managed mode — so it is
 * gated on a live paid subscription.
 *
 * The interesting cases are all the edges: a plan that is paid but no longer
 * collecting, billing being unreachable, and a user who was never signed in.
 */

const billing = vi.hoisted(() => ({
  get: vi.fn(),
}));
vi.mock("./billing.js", () => ({
  getBillingInfo: billing.get,
}));

function info(plan: string | null, status: string | null) {
  return { subscriptionPlan: plan, subscriptionStatus: status };
}

let entitlements: typeof import("./entitlements.js");

beforeEach(async () => {
  vi.resetModules();
  billing.get.mockReset();
  entitlements = await import("./entitlements.js");
  entitlements.resetEntitlementCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isPaidSubscription", () => {
  it("accepts the paid plans", () => {
    for (const plan of ["starter", "pro", "intelligence"]) {
      expect(entitlements.isPaidSubscription(plan as never, "active")).toBe(true);
    }
  });

  it("rejects free regardless of status", () => {
    expect(entitlements.isPaidSubscription("free", "active")).toBe(false);
    expect(entitlements.isPaidSubscription(null, "active")).toBe(false);
  });

  it("counts a trial on a paid plan as paying", () => {
    // A trial is how a paid plan starts; gating it would demo the product
    // without the thing being evaluated.
    expect(entitlements.isPaidSubscription("pro", "trialing")).toBe(true);
  });

  it("rejects a paid plan that stopped collecting", () => {
    // The plan column still says pro after a card fails or the sub is
    // cancelled; the status is the only thing that says it is not paying.
    expect(entitlements.isPaidSubscription("pro", "past_due")).toBe(false);
    expect(entitlements.isPaidSubscription("pro", "canceled")).toBe(false);
  });

  it("treats a missing status as authoritative-by-plan", () => {
    expect(entitlements.isPaidSubscription("pro", null)).toBe(true);
  });
});

describe("hasPaidSubscription", () => {
  it("is true for a live paid plan", async () => {
    billing.get.mockResolvedValue(info("pro", "active"));
    await expect(entitlements.hasPaidSubscription()).resolves.toBe(true);
  });

  it("is false on the free plan", async () => {
    billing.get.mockResolvedValue(info("free", "active"));
    await expect(entitlements.hasPaidSubscription()).resolves.toBe(false);
  });

  it("fails closed when billing cannot be reached and nothing is cached", async () => {
    // Not signed in presents exactly this way. "We could not check" is not
    // permission to spend our money on inference.
    billing.get.mockRejectedValue(new Error("offline"));
    await expect(entitlements.hasPaidSubscription()).resolves.toBe(false);
  });

  it("keeps a recent answer through a blip", async () => {
    const t0 = 1_000_000;
    billing.get.mockResolvedValue(info("pro", "active"));
    await entitlements.hasPaidSubscription(t0);

    billing.get.mockRejectedValue(new Error("offline"));
    // A paid customer must not lose the feature because the network hiccuped.
    await expect(entitlements.hasPaidSubscription(t0 + 60_000)).resolves.toBe(true);
  });

  it("stops trusting a cached answer once it goes stale", async () => {
    const t0 = 1_000_000;
    billing.get.mockResolvedValue(info("pro", "active"));
    await entitlements.hasPaidSubscription(t0);

    billing.get.mockRejectedValue(new Error("offline"));
    const past = t0 + entitlements.ENTITLEMENT_GRACE_MS + 1;
    await expect(entitlements.hasPaidSubscription(past)).resolves.toBe(false);
  });

  it("does not cache a cached 'false' into permanence", async () => {
    // Upgrading must take effect on the next tick, not after the grace window.
    billing.get.mockResolvedValue(info("free", "active"));
    await expect(entitlements.hasPaidSubscription(1_000)).resolves.toBe(false);

    billing.get.mockResolvedValue(info("pro", "active"));
    await expect(entitlements.hasPaidSubscription(2_000)).resolves.toBe(true);
  });
});
