// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));
vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: function ConversationMock(props: Record<string, unknown>) {
    return createElement("div", null, props.children as never);
  },
  ConversationContent: function ConversationContentMock(props: Record<string, unknown>) {
    return createElement("div", null, props.children as never);
  },
}));
vi.mock("@/components/features/dashboard/chat-route-provider/chat-route-provider", () => ({
  useChatRouteState: () => ({
    activeAgent: "Revenue operator",
    artifact: null,
    conversation: [],
    empty: true,
    onOpenRevenueTab: vi.fn(),
    onResolveApproval: vi.fn(),
    onSelectPrompt: vi.fn(),
    processing: false,
    promptInput: createElement("label", null, "Brief"),
    workspace: "Acme",
  }),
}));
vi.mock("@/components/auth/auth-gate", () => ({
  useAuthSession: () => ({ user: { email: "morgan@acme.com", workosUserId: "user-1" } }),
}));

import { ChatDashboardRoute } from "./chat-dashboard-route";

describe("ChatDashboardRoute", () => {
  it("forwards accessible section props and renders its content boundary", () => {
    render(createElement(ChatDashboardRoute, { "aria-label": "Chat home" }, "Content"));

    const route = screen.getByRole("region", { name: "Chat home" });
    expect(route).toHaveAttribute("data-slot", "chat-dashboard-route");
  });
});
