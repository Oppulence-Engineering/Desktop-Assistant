// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const billing = vi.hoisted(() => ({
  capture: vi.fn(),
  startCheckout: vi.fn(),
}));

vi.mock("@/lib/analytics/analytics", () => ({
  capture: billing.capture,
  RevenueEvents: { UpgradeClicked: "revenue_upgrade_clicked" },
}));
vi.mock("@/lib/revenue/revenue", () => ({
  startCheckout: billing.startCheckout,
}));

import { PlanSection } from "@/components/features/settings/app-settings/app-settings";

const session = (plan: string) => ({
  billing: { plan, status: "active", usage: {} },
  user: { permissions: [] },
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("settings billing upgrade", () => {
  it("offers checkout outside the recovery flow and recovers from a transient failure", async () => {
    const user = userEvent.setup();
    billing.startCheckout.mockRejectedValue(new Error("checkout unavailable"));
    render(<PlanSection session={session("free")} />);

    const upgrade = screen.getByRole("button", { name: /upgrade to pro/i });
    await user.click(upgrade);

    expect(billing.startCheckout).toHaveBeenCalledWith("pro");
    expect(billing.capture).toHaveBeenCalledWith("revenue_upgrade_clicked", {
      from: "settings",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Checkout is temporarily unavailable",
    );
    expect(upgrade).toBeEnabled();
  });

  it("does not upsell a workspace that is already on Pro", () => {
    render(<PlanSection session={session("pro")} />);
    expect(screen.queryByRole("button", { name: /upgrade/i })).not.toBeInTheDocument();
  });
});
