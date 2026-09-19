// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => () => <div>Revenue</div>,
}));
vi.mock("@/hooks/use-product-route-state", () => ({
  useProductRouteState: () => ({
    openRevenueTab: vi.fn(),
    openSettings: vi.fn(),
    revenueTab: "commitments",
  }),
}));

import { RevenueDashboardRoute } from "./revenue-dashboard-route";

describe("RevenueDashboardRoute", () => {
  it("forwards accessible section props and renders its content", () => {
    render(<RevenueDashboardRoute aria-label="Revenue">Content</RevenueDashboardRoute>);

    const route = screen.getByRole("region", { name: "Revenue" });
    expect(route).toHaveAttribute("data-slot", "revenue-dashboard-route");
    expect(route).toHaveTextContent("Revenue");
  });
});
