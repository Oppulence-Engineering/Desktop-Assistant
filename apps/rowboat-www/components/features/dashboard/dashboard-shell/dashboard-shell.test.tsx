// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearSelectedResource: vi.fn(),
  setPaletteOpen: vi.fn(),
  setSidebarOpen: vi.fn(),
}));

vi.mock("@/components/app-shell", () => ({
  AppShellSidebar: () => <aside aria-label="Sidebar" />,
  AppTopBar: ({ onAsk }: { onAsk: () => void }) => (
    <button onClick={onAsk} type="button">
      Ask
    </button>
  ),
  REVENUE_TAB_LABELS: { commitments: "Commitments" },
  SETTINGS_SECTIONS: [{ key: "overview", label: "Settings" }],
  ViewBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/auth-gate", () => ({
  useAuthSession: () => ({
    user: { email: "person@example.com", organizationId: "org" },
    billing: null,
  }),
}));
vi.mock("@/components/command-palette", () => ({
  CommandPalette: ({ open }: { open: boolean }) => (
    <div aria-label="Command palette" data-open={String(open)} />
  ),
}));
vi.mock("@/components/features/dashboard/chat-route-provider/chat-route-provider", () => ({
  useDashboardChatController: () => ({
    agentOptions: ["assistant"],
    activeRunId: null,
    empty: true,
    sessions: [],
    selectedResource: null,
    clearSelectedResource: mocks.clearSelectedResource,
    onAgentsChanged: vi.fn(),
    onNewChat: vi.fn(),
    onOpenAgent: vi.fn(),
    onOpenResource: vi.fn(),
    onOpenSession: vi.fn(),
    onUseAgent: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-product-route-state", () => ({
  useProductRouteState: () => ({
    view: "chat",
    revenueTab: "commitments",
    settingsSection: "overview",
    workflowFocus: "scheduled",
    navigateTo: vi.fn(),
    openRevenueTab: vi.fn(),
    openSettings: vi.fn(),
    openWorkflows: vi.fn(),
  }),
}));
vi.mock("@/lib/console-prefs", () => ({
  useBooleanPref: () => [true, mocks.setSidebarOpen],
}));
vi.mock("@/lib/icons", () => ({ SidebarSimple: () => <span aria-hidden /> }));

import { DashboardShell } from "./dashboard-shell";

describe("DashboardShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("forwards accessible section props and renders its content", () => {
    render(<DashboardShell aria-label="Example dashboard-shell">Content</DashboardShell>);

    const component = screen.getByRole("region", { name: "Example dashboard-shell" });
    expect(component).toHaveAttribute("data-slot", "dashboard-shell");
    expect(component).toHaveTextContent("Content");
  });

  it("owns command-palette and sidebar keyboard handling", () => {
    render(<DashboardShell aria-label="Dashboard">Content</DashboardShell>);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByLabelText("Command palette")).toHaveAttribute("data-open", "true");

    fireEvent.keyDown(window, { key: "[" });
    expect(mocks.setSidebarOpen).toHaveBeenCalledWith(false);

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "[" });
    expect(mocks.setSidebarOpen).toHaveBeenCalledTimes(1);
    input.remove();
  });
});
