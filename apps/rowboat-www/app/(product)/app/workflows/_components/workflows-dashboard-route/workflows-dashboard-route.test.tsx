// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => () => <div>Workflows</div>,
}));
vi.mock("@/components/features/dashboard/chat-route-provider/chat-route-provider", () => ({
  useDashboardChatController: () => ({ selectedResource: null }),
}));

import { WorkflowsDashboardRoute } from "./workflows-dashboard-route";

describe("WorkflowsDashboardRoute", () => {
  it("forwards accessible section props and renders its content", () => {
    render(
      <WorkflowsDashboardRoute aria-label="Workflows" focus="scheduled">
        Content
      </WorkflowsDashboardRoute>,
    );

    const route = screen.getByRole("region", { name: "Workflows" });
    expect(route).toHaveAttribute("data-slot", "workflows-dashboard-route");
    expect(route).toHaveTextContent("Workflows");
  });
});
