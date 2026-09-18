"use client";

import "client-only";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type RefObject,
  type ReactNode,
} from "react";

import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSpeechButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { useAuthSession } from "@/components/auth-gate";
import { useWorkspaceLabel } from "@/components/app-shell";
import { useAgentCatalog } from "@/hooks/use-agent-catalog";
import { useAgentRun } from "@/hooks/use-agent-run";
import { useChatSessions } from "@/hooks/use-chat-sessions";
import { useDashboardArtifact } from "@/hooks/use-dashboard-artifact";
import { useProductRouteState } from "@/hooks/use-product-route-state";
import type { ApprovalRequest, ConversationItem } from "@/lib/agent-history";
import {
  WEB_CHAT_ACCEPT,
  WEB_CHAT_MAX_FILE_BYTES,
  WEB_CHAT_MAX_FILES,
} from "@/lib/chat-attachments";
import type { SessionMeta, SessionScope } from "@/lib/chat-sessions";
import type { SelectedResource } from "@/lib/dashboard-resource";
import type { RevenueTab, WorkflowFocus } from "@/lib/product-navigation";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@oppulence/ui/components/select";
import { cn } from "@oppulence/ui/lib/utils";

export type ChatArtifactState = NonNullable<ReturnType<typeof useDashboardArtifact>> & {
  agentOptions: string[];
  onClose: () => void;
};

export type ChatRouteState = {
  activeAgent: string;
  workspace: string;
  processing: boolean;
  conversation: ConversationItem[];
  empty: boolean;
  promptInput: ReactNode;
  artifact: ChatArtifactState | null;
  onOpenRevenueTab: (tab: RevenueTab) => void;
  onSelectPrompt: (prompt: string) => void;
  onResolveApproval: (approval: ApprovalRequest, decision: "granted" | "denied") => Promise<void>;
};

export type DashboardChatController = {
  agentOptions: string[];
  activeRunId: string | null;
  empty: boolean;
  sessions: SessionMeta[];
  selectedResource: SelectedResource | null;
  clearSelectedResource: () => void;
  onAgentsChanged: () => Promise<void>;
  onNewChat: () => void;
  onOpenAgent: (slug: string) => void;
  onOpenResource: (resource: SelectedResource) => void;
  onOpenSession: (runId: string) => Promise<void>;
  onUseAgent: (slug: string) => void;
};

type ChatRouteContextValue = {
  chat: ChatRouteState;
  controller: DashboardChatController;
};

const ChatRouteContext = createContext<ChatRouteContextValue | null>(null);

export type ChatRouteProviderProps = ComponentPropsWithoutRef<"section">;

function useChatContext(): ChatRouteContextValue {
  const value = useContext(ChatRouteContext);
  if (!value) {
    throw new Error("Chat route state must be rendered inside ChatRouteProvider");
  }
  return value;
}

export function useChatRouteState(): ChatRouteState {
  return useChatContext().chat;
}

export function useDashboardChatController(): DashboardChatController {
  return useChatContext().controller;
}

type ChatPromptInputProps = {
  agentOptions: string[];
  chatError: string | null;
  empty: boolean;
  selectedAgent: string;
  setChatError: (message: string) => void;
  setText: (text: string) => void;
  status: ReturnType<typeof useAgentRun>["status"];
  stopRun: () => Promise<void>;
  submit: ReturnType<typeof useAgentRun>["submit"];
  text: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onSelectAgent: (agent: string) => void;
};

/**
 * Keeps the prompt's attachment and stop semantics beside the chat lifecycle
 * that owns them, rather than coupling shell chrome to agent-run details.
 */
function ChatPromptInput({
  agentOptions,
  chatError,
  empty,
  onSelectAgent,
  selectedAgent,
  setChatError,
  setText,
  status,
  stopRun,
  submit,
  text,
  textareaRef,
}: ChatPromptInputProps) {
  return (
    <div className="space-y-2">
      {chatError ? (
        <p className="text-left text-sm text-destructive" role="alert">
          {chatError}
        </p>
      ) : null}
      <PromptInput
        accept={WEB_CHAT_ACCEPT}
        globalDrop
        maxFiles={WEB_CHAT_MAX_FILES}
        maxFileSize={WEB_CHAT_MAX_FILE_BYTES}
        multiple
        onError={({ message }) => setChatError(message)}
        onSubmit={submit}
      >
        <PromptInputHeader>
          <PromptInputAttachments>
            {(attachment) => <PromptInputAttachment data={attachment} />}
          </PromptInputAttachments>
        </PromptInputHeader>
        <PromptInputBody>
          <PromptInputTextarea
            ref={textareaRef}
            className={empty ? "min-h-12 max-h-[200px]" : "min-h-[46px] max-h-[200px]"}
            onChange={(event) => setText(event.target.value)}
            placeholder={
              empty ? "Name the loose end…" : "Ask about a client, commitment, or next step"
            }
            value={text}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments label="Add text file" />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
            <PromptInputSpeechButton
              aria-label="Dictate message"
              onTranscriptionChange={setText}
              textareaRef={textareaRef}
            />
            <Select onValueChange={onSelectAgent} value={selectedAgent}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {agentOptions.map((agent) => (
                    <SelectItem key={agent} value={agent}>
                      {agent}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </PromptInputTools>
          <PromptInputSubmit
            aria-label={status === "streaming" ? "Stop response" : "Submit"}
            disabled={status === "submitted"}
            onClick={(event) => {
              if (status !== "streaming") return;
              event.preventDefault();
              void stopRun();
            }}
            status={status}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

export function ChatRouteProvider({ children, className, ...props }: ChatRouteProviderProps) {
  const session = useAuthSession();
  const { navigateTo, openRevenueTab, openWorkflows } = useProductRouteState();
  const sessionScope = useMemo<SessionScope>(
    () => ({
      organizationId: session.user.organizationId,
      userId: session.user.id ?? session.user.workosUserId ?? session.user.email ?? "unknown-user",
    }),
    [session.user.email, session.user.id, session.user.organizationId, session.user.workosUserId],
  );
  const workspaceUser = useMemo(
    () => ({
      name: session.user.email || session.user.workosUserId || "User",
      email: session.user.email || session.user.workosUserId || "",
    }),
    [session.user.email, session.user.workosUserId],
  );
  const workspace = useWorkspaceLabel(workspaceUser);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [selectedResource, setSelectedResource] = useState<SelectedResource | null>(null);
  const { agentOptions, refreshAgents, selectedAgent, setSelectedAgent } = useAgentCatalog();
  const run = useAgentRun(selectedAgent);

  const selectPrompt = useCallback(
    (prompt: string) => {
      run.setText(prompt);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [run],
  );
  const clearSelectedResource = useCallback(() => setSelectedResource(null), []);
  const startNewChat = useCallback(() => {
    run.resetRun();
    clearSelectedResource();
    navigateTo("chat");
  }, [clearSelectedResource, navigateTo, run]);
  const selectAgent = useCallback(
    (agent: string) => {
      if (agent === selectedAgent) return;
      startNewChat();
      setSelectedAgent(agent);
    },
    [selectedAgent, setSelectedAgent, startNewChat],
  );
  const useAgent = useCallback(
    (agent: string) => {
      startNewChat();
      setSelectedAgent(agent);
    },
    [setSelectedAgent, startNewChat],
  );
  const { openSession: loadSession, sessions } = useChatSessions({
    activeRunId: run.runId,
    conversation: run.conversation,
    onBeginOpen: run.beginOpenRun,
    onFailedOpen: run.failOpenRun,
    onOpen: run.openRun,
    onSelectAgent: setSelectedAgent,
    scope: sessionScope,
    selectedAgent,
  });
  const openSession = useCallback(
    async (nextRunId: string) => {
      if (nextRunId === run.runId) {
        navigateTo("chat");
        return;
      }
      navigateTo("chat");
      clearSelectedResource();
      await loadSession(nextRunId);
    },
    [clearSelectedResource, loadSession, navigateTo, run.runId],
  );
  const openAgent = useCallback(
    (slug: string) => {
      setSelectedResource({ kind: "agent", name: slug });
      navigateTo("chat");
    },
    [navigateTo],
  );
  const openResource = useCallback(
    (resource: SelectedResource) => {
      if (resource.kind === "task" || resource.kind === "taskrun") {
        const focus: WorkflowFocus = resource.kind === "taskrun" ? "runs" : "scheduled";
        openWorkflows(focus);
      } else {
        navigateTo("chat");
      }
      setSelectedResource(resource);
    },
    [navigateTo, openWorkflows],
  );
  const artifact = useDashboardArtifact(selectedResource);
  const promptInput = (
    <ChatPromptInput
      agentOptions={agentOptions}
      chatError={run.chatError}
      empty={run.conversation.length === 0}
      onSelectAgent={selectAgent}
      selectedAgent={selectedAgent}
      setChatError={run.setChatError}
      setText={run.setText}
      status={run.status}
      stopRun={run.stopRun}
      submit={run.submit}
      text={run.text}
      textareaRef={textareaRef}
    />
  );
  const value: ChatRouteContextValue = {
    chat: {
      activeAgent: selectedAgent,
      workspace,
      processing: run.processing,
      conversation: run.conversation,
      empty: run.conversation.length === 0,
      promptInput,
      artifact: artifact ? { ...artifact, agentOptions, onClose: clearSelectedResource } : null,
      onOpenRevenueTab: openRevenueTab,
      onSelectPrompt: selectPrompt,
      onResolveApproval: run.resolveApproval,
    },
    controller: {
      agentOptions,
      activeRunId: run.runId,
      empty: run.conversation.length === 0,
      sessions,
      selectedResource,
      clearSelectedResource,
      onAgentsChanged: refreshAgents,
      onNewChat: startNewChat,
      onOpenAgent: openAgent,
      onOpenResource: openResource,
      onOpenSession: openSession,
      onUseAgent: useAgent,
    },
  };

  return (
    <ChatRouteContext.Provider value={value}>
      <section className={cn("contents", className)} data-slot="chat-route-provider" {...props}>
        {children}
      </section>
    </ChatRouteContext.Provider>
  );
}
