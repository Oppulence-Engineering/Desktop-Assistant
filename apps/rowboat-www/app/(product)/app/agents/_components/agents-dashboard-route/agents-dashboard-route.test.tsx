// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => () => <div>Agents</div>,
}));
vi.mock("@/components/features/dashboard/chat-route-provider/chat-route-provider", () => ({
  useDashboardChatController: () => ({
    onAgentsChanged: vi.fn(),
    onOpenAgent: vi.fn(),
    onUseAgent: vi.fn(),
  }),
}));

import { AgentsDashboardRoute } from "./agents-dashboard-route";

describe("AgentsDashboardRoute", () => {
  it("forwards accessible section props and renders its content", () => {
    render(<AgentsDashboardRoute aria-label="Agents">Content</AgentsDashboardRoute>);

    const route = screen.getByRole("region", { name: "Agents" });
    expect(route).toHaveAttribute("data-slot", "agents-dashboard-route");
    expect(route).toHaveTextContent("Agents");
  });
});
