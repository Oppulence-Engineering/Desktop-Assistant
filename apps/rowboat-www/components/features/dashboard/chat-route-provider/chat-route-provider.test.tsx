// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  resetRun: vi.fn(),
}));

vi.mock("@/components/ai-elements/prompt-input", () => ({
  PromptInput: ({ children }: { children: React.ReactNode }) => <form>{children}</form>,
  PromptInputActionAddAttachments: () => null,
  PromptInputActionMenu: ({ children }: { children: React.ReactNode }) => children,
  PromptInputActionMenuContent: ({ children }: { children: React.ReactNode }) => children,
  PromptInputActionMenuTrigger: () => null,
  PromptInputAttachment: () => null,
  PromptInputAttachments: () => null,
  PromptInputBody: ({ children }: { children: React.ReactNode }) => children,
  PromptInputFooter: ({ children }: { children: React.ReactNode }) => children,
  PromptInputHeader: ({ children }: { children: React.ReactNode }) => children,
  PromptInputSpeechButton: () => null,
  PromptInputSubmit: () => <button type="submit">Submit</button>,
  PromptInputTextarea: ({ placeholder }: { placeholder: string }) => (
    <textarea aria-label="Prompt" placeholder={placeholder} />
  ),
  PromptInputTools: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/features/dashboard/app-shell/app-shell", () => ({
  useWorkspaceLabel: () => "Acme",
}));
vi.mock("@/components/auth/auth-gate", () => ({
  useAuthSession: () => ({
    user: { email: "person@example.com", organizationId: "org", id: "user" },
  }),
}));
vi.mock("@/hooks/dashboard/use-agent-catalog", () => ({
  useAgentCatalog: () => ({
    agentOptions: ["assistant"],
    refreshAgents: vi.fn(),
    selectedAgent: "assistant",
    setSelectedAgent: vi.fn(),
  }),
}));
vi.mock("@/hooks/dashboard/use-agent-run", () => ({
  useAgentRun: () => ({
    beginOpenRun: vi.fn(),
    chatError: null,
    conversation: [],
    failOpenRun: vi.fn(),
    openRun: vi.fn(),
    processing: false,
    resetRun: mocks.resetRun,
    resolveApproval: vi.fn(),
    runId: null,
    setChatError: vi.fn(),
    setText: vi.fn(),
    status: "ready",
    stopRun: vi.fn(),
    submit: vi.fn(),
    text: "",
  }),
}));
vi.mock("@/hooks/dashboard/use-chat-sessions", () => ({
  useChatSessions: () => ({ openSession: vi.fn(), sessions: [] }),
}));
vi.mock("@/hooks/dashboard/use-dashboard-artifact", () => ({
  useDashboardArtifact: () => null,
}));
vi.mock("@/hooks/dashboard/use-product-route-state", () => ({
  useProductRouteState: () => ({
    navigateTo: mocks.navigateTo,
    openRevenueTab: vi.fn(),
    openWorkflows: vi.fn(),
  }),
}));
vi.mock("@oppulence/ui/components/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => children,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectGroup: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ children }: { children: React.ReactNode }) => children,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectValue: () => <span>Agent</span>,
}));

import {
  ChatRouteProvider,
  useChatRouteState,
  useDashboardChatController,
} from "./chat-route-provider";

function ContextProbe() {
  const chat = useChatRouteState();
  const controller = useDashboardChatController();
  return (
    <>
      <span>{chat.workspace}</span>
      {chat.promptInput}
      <button onClick={controller.onNewChat} type="button">
        New chat
      </button>
    </>
  );
}

describe("ChatRouteProvider", () => {
  it("provides persistent chat lifecycle state and forwards section props", () => {
    render(
      <ChatRouteProvider aria-label="Example chat-route-provider">
        <ContextProbe />
      </ChatRouteProvider>,
    );

    const component = screen.getByRole("region", { name: "Example chat-route-provider" });
    expect(component).toHaveAttribute("data-slot", "chat-route-provider");
    expect(component).toHaveTextContent("Acme");
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveAttribute(
      "placeholder",
      "Name the loose end…",
    );

    screen.getByRole("button", { name: "New chat" }).click();
    expect(mocks.resetRun).toHaveBeenCalledOnce();
    expect(mocks.navigateTo).toHaveBeenCalledWith("chat");
  });
});
