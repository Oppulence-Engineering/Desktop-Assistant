// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => () => <div>Settings</div>,
}));
vi.mock("@/components/auth-gate", () => ({
  useAuthSession: () => ({ user: { email: "morgan@acme.com" } }),
}));
vi.mock("@/hooks/use-product-route-state", () => ({
  useProductRouteState: () => ({ openSettings: vi.fn() }),
}));

import { SettingsDashboardRoute } from "./settings-dashboard-route";

describe("SettingsDashboardRoute", () => {
  it("forwards accessible section props and renders its content", () => {
    render(
      <SettingsDashboardRoute aria-label="Settings" section="overview">
        Content
      </SettingsDashboardRoute>,
    );

    const route = screen.getByRole("region", { name: "Settings" });
    expect(route).toHaveAttribute("data-slot", "settings-dashboard-route");
    expect(route).toHaveTextContent("Settings");
  });
});
