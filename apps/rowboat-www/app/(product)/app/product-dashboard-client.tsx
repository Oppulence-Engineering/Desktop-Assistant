"use client";

import {
  AppShellSidebar,
  AppTopBar,
  REVENUE_TAB_LABELS,
  SETTINGS_SECTIONS,
  useWorkspaceLabel,
  ViewBoundary,
} from "@/components/app-shell";
import { AuthGate, useAuthSession } from "@/components/auth-gate";
import { CommandPalette } from "@/components/command-palette";
import {
  DashboardRouteProvider,
  type DashboardRouteContextValue,
} from "@/components/features/dashboard/dashboard-route-content/dashboard-route-context";
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSpeechButton,
  PromptInputSubmit,
  PromptInputAttachments,
  PromptInputAttachment,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
  PromptInputHeader,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { useState, useEffect, useRef, type ReactNode, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { SidebarSimple } from "@phosphor-icons/react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@oppulence/ui/components/select";
import { dashboardFetch } from "@/lib/auth/client";
import { readAgentEventStream, type AgentStreamEvent } from "@/lib/agent-stream";
import {
  conversationFromAgentEvents,
  friendlyAgentError,
  parseAgentSessionEventsResponse,
  parseAgentSessionsResponse,
  type AgentHistoryItem,
  type ApprovalRequest,
  type ConversationItem,
} from "@/lib/agent-history";
import type { DurableAgentSessionEvent } from "@/lib/api/generated/client/model/durableAgentSessionEvent";
import { parseAgentsResponse } from "@/lib/agents/agent-schemas";
import { useBooleanPref, usePref } from "@/lib/console-prefs";
import { requestDashboardJson } from "@/lib/dashboard-json";
import type { SelectedResource } from "@/lib/dashboard-resource";
import {
  ApprovalTokenResponseSchema,
  CreatedAgentSessionSchema,
  MutationResponseSchema,
} from "@/lib/dashboard-schemas";
import {
  prepareWebChatInput,
  WEB_CHAT_ACCEPT,
  WEB_CHAT_MAX_FILE_BYTES,
  WEB_CHAT_MAX_FILES,
} from "@/lib/chat-attachments";
import { useProductRouteState } from "@/hooks/use-product-route-state";
import { useDashboardArtifact } from "@/hooks/use-dashboard-artifact";
import {
  listSessions,
  loadSession,
  mergeSessionLists,
  saveSession,
  type SessionMeta,
  type SessionScope,
} from "@/lib/chat-sessions";

type ChatMessage = Extract<AgentHistoryItem, { type: "message" }>;

function stripExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, "");
}

function PageBody({ children }: { children: ReactNode }) {
  const session = useAuthSession();
  const {
    view,
    revenueTab,
    settingsSection,
    workflowFocus,
    navigateTo,
    openRevenueTab,
    openSettings,
    openWorkflows,
  } = useProductRouteState();
  const sessionScope = useMemo<SessionScope>(
    () => ({
      organizationId: session.user.organizationId,
      userId: session.user.id ?? session.user.workosUserId ?? session.user.email ?? "unknown-user",
    }),
    [session.user.email, session.user.id, session.user.organizationId, session.user.workosUserId],
  );
  const shellUser = useMemo(
    () => ({
      name: session.user.email || session.user.workosUserId || "User",
      email: session.user.email || session.user.workosUserId || "",
    }),
    [session.user.email, session.user.workosUserId],
  );
  const workspace = useWorkspaceLabel(shellUser);
  const [text, setText] = useState<string>("");
  const [status, setStatus] = useState<"submitted" | "streaming" | "ready" | "error">("ready");
  const [chatError, setChatError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Chat state
  const [runId, setRunId] = useState<string | null>(null);
  const streamUrl = runId
    ? `/api/rowboat/v1/agent-sessions/${encodeURIComponent(runId)}/stream`
    : null;
  const [isRunProcessing, setIsRunProcessing] = useState(false);
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const streamAbortRef = useRef<AbortController | null>(null);
  const committedMessageIds = useRef<Set<string>>(new Set());
  const isEmptyConversation = conversation.length === 0;
  const [selectedResource, setSelectedResource] = useState<SelectedResource | null>(null);
  const [sidebarOpen, setSidebarOpen] = useBooleanPref("app-sidebar-open", true);
  const [remoteSessions, setRemoteSessions] = useState<SessionMeta[]>([]);
  // The local store contains at most 30 entries, so deriving this during render
  // is cheaper and safer than duplicating synchronized session-list state.
  const sessions = mergeSessionLists(listSessions(sessionScope), remoteSessions);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const preferredAgent = usePref("default-agent");
  const [selectedAgentOverride, setSelectedAgent] = useState<string | null>(null);
  const configuredAgent = selectedAgentOverride ?? preferredAgent ?? "assistant";
  const { data: discoveredAgents = [], refetch: refetchAgents } = useQuery({
    queryKey: ["dashboard", "agent-options"],
    queryFn: async () => {
      const response = await dashboardFetch("/api/rowboat/v1/agents");
      if (!response.ok) throw new Error(`Could not load agents (${response.status})`);
      return parseAgentsResponse(await response.json()).map((agent) => stripExtension(agent.slug));
    },
  });
  const agentOptions = useMemo(
    () => Array.from(new Set(["assistant", ...discoveredAgents])),
    [discoveredAgents],
  );
  const selectedAgent = agentOptions.includes(configuredAgent) ? configuredAgent : "assistant";
  const loadAgentOptions = useCallback(async () => {
    await refetchAgents();
  }, [refetchAgents]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await dashboardFetch("/api/rowboat/v1/agent-sessions");
        if (!response.ok) return;
        const remote = parseAgentSessionsResponse(await response.json()).map<SessionMeta>(
          (agentSession) => ({
            runId: agentSession.sessionId,
            title:
              agentSession.title ||
              `${agentSession.agent} · ${new Date(agentSession.lastActivityAt || agentSession.createdAt).toLocaleDateString()}`,
            agent: agentSession.agent,
            updatedAt: new Date(agentSession.lastActivityAt || agentSession.createdAt).getTime(),
          }),
        );
        if (!cancelled) setRemoteSessions(remote);
      } catch (error) {
        console.error("Failed to load durable chat history", error);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionScope]);

  // Retain the transcript only for this authenticated in-memory session.
  useEffect(() => {
    if (!runId || conversation.length === 0) return;
    const firstMessage = conversation.find(
      (item): item is ChatMessage => item.type === "message" && item.role === "user",
    );
    saveSession(sessionScope, {
      runId,
      title: (firstMessage?.content || "New conversation").slice(0, 60),
      agent: selectedAgent,
      updatedAt: Date.now(),
      items: conversation,
    });
  }, [conversation, runId, selectedAgent, sessionScope]);

  const startNewChat = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    committedMessageIds.current = new Set();
    setRunId(null);
    setConversation([]);
    setStatus("ready");
    setSelectedResource(null);
    navigateTo("chat");
  }, [navigateTo]);

  const selectAgent = useCallback(
    (agent: string) => {
      if (agent === selectedAgent) return;
      startNewChat();
      setSelectedAgent(agent);
    },
    [selectedAgent, startNewChat],
  );

  const openSession = useCallback(
    async (nextRunId: string) => {
      if (nextRunId === runId) {
        navigateTo("chat");
        return;
      }
      const stored = loadSession(sessionScope, nextRunId);
      navigateTo("chat");
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      setSelectedResource(null);
      setChatError(null);

      try {
        let items = stored?.items;
        const meta = sessions.find((entry) => entry.runId === nextRunId);
        if (!items) {
          setStatus("submitted");
          const events: DurableAgentSessionEvent[] = [];
          let afterSeq: number | undefined;
          // ponytail: cap pathological histories; add virtualized incremental loading past 50k events.
          for (let page = 0; page < 50; page += 1) {
            const query = new URLSearchParams({ limit: "1000" });
            if (afterSeq !== undefined) query.set("afterSeq", String(afterSeq));
            const response = await dashboardFetch(
              `/api/rowboat/v1/agent-sessions/${encodeURIComponent(nextRunId)}/events?${query}`,
            );
            if (!response.ok) throw new Error(`Could not load conversation (${response.status})`);
            const data = parseAgentSessionEventsResponse(await response.json());
            events.push(...data.events);
            if (data.nextSeq == null || data.nextSeq === afterSeq) break;
            afterSeq = data.nextSeq;
          }
          items = conversationFromAgentEvents(events);
          saveSession(sessionScope, {
            runId: nextRunId,
            title: meta?.title || "Conversation",
            agent: meta?.agent,
            updatedAt: meta?.updatedAt || Date.now(),
            items,
          });
        }
        committedMessageIds.current = new Set(items.map((item) => item.id));
        setConversation(items);
        setStatus("ready");
        if (stored?.agent || meta?.agent)
          setSelectedAgent(stored?.agent || meta?.agent || "assistant");
        setRunId(nextRunId);
      } catch (error) {
        setConversation([]);
        setStatus("error");
        setChatError(error instanceof Error ? error.message : "Could not load conversation");
      }
    },
    [navigateTo, runId, sessionScope, sessions],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(!sidebarOpen);
  }, [setSidebarOpen, sidebarOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "[" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);
  const artifact = useDashboardArtifact(selectedResource);

  const stopRun = async () => {
    if (!runId) return;
    setStatus("submitted");
    try {
      await requestDashboardJson(
        `/agent-sessions/${encodeURIComponent(runId)}/cancel`,
        MutationResponseSchema,
        { method: "POST" },
      );
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      setRunId(null);
      setIsRunProcessing(false);
      setStatus("ready");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Could not stop the run");
      setStatus("streaming");
    }
  };

  const resolveApproval = async (approval: ApprovalRequest, decision: "granted" | "denied") => {
    if (!runId) return;
    setConversation((items) =>
      items.map((item) =>
        item.type === "approval" && item.approvalId === approval.approvalId
          ? { ...item, status: "resolving" }
          : item,
      ),
    );
    try {
      let approvalToken: string | undefined;
      if (decision === "granted" && approval.trustTier === "money-moving") {
        const token = await requestDashboardJson(
          `/agent-sessions/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approval.approvalId)}/token`,
          ApprovalTokenResponseSchema,
          { method: "POST" },
        );
        approvalToken = token?.approvalToken;
        if (!approvalToken) throw new Error("The approval token could not be created");
      }
      await requestDashboardJson(
        `/agent-sessions/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approval.approvalId)}`,
        MutationResponseSchema,
        {
          method: "POST",
          headers: approvalToken ? { "X-Approval-Token": approvalToken } : undefined,
          body: JSON.stringify({ decision }),
        },
      );
      setConversation((items) =>
        items.map((item) =>
          item.type === "approval" && item.approvalId === approval.approvalId
            ? { ...item, status: decision }
            : item,
        ),
      );
    } catch (error) {
      setConversation((items) =>
        items.map((item) =>
          item.type === "approval" && item.approvalId === approval.approvalId
            ? { ...item, status: "pending" }
            : item,
        ),
      );
      setChatError(error instanceof Error ? error.message : "Could not resolve the approval");
    }
  };

  const renderPromptInput = () => (
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
        onSubmit={handleSubmit}
      >
        <PromptInputHeader>
          <PromptInputAttachments>
            {(attachment) => <PromptInputAttachment data={attachment} />}
          </PromptInputAttachments>
        </PromptInputHeader>
        <PromptInputBody>
          <PromptInputTextarea
            ref={textareaRef}
            onChange={(event) => setText(event.target.value)}
            value={text}
            placeholder="Ask about a client, commitment, or next step"
            className="min-h-[46px] max-h-[200px]"
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
            <Select value={selectedAgent} onValueChange={selectAgent}>
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

  // Handle different event types from the copilot
  const handleEvent = useCallback((event: AgentStreamEvent) => {
    console.log("Event received:", event.type, event);
    const payload = event.data;

    switch (event.type) {
      case "agent.session_started":
      case "agent.turn_started":
      case "agent.llm_call_started":
        setIsRunProcessing(true);
        setStatus("streaming");
        break;

      case "agent.message": {
        const content = typeof payload.content === "string" ? payload.content : "";
        const messageId = `assistant-${event.seq ?? Date.now()}`;
        if (!content || committedMessageIds.current.has(messageId)) break;
        committedMessageIds.current.add(messageId);
        setConversation((items) => [
          ...items,
          {
            id: messageId,
            type: "message",
            role: "assistant",
            content,
            timestamp: Date.now(),
          },
        ]);
        break;
      }

      case "agent.tool_call_started": {
        const id = `tool-${event.turnSeq ?? "unknown"}-${String(payload.callIndex ?? "unknown")}`;
        const name = typeof payload.tool === "string" ? payload.tool : "tool";
        setConversation((items) =>
          items.some((item) => item.id === id)
            ? items.map((item) =>
                item.id === id && item.type === "tool" ? { ...item, status: "running" } : item,
              )
            : [
                ...items,
                {
                  id,
                  type: "tool",
                  name,
                  input: {},
                  status: "running",
                  timestamp: Date.now(),
                },
              ],
        );
        break;
      }

      case "agent.tool_call_completed": {
        const id = `tool-${event.turnSeq ?? "unknown"}-${String(payload.callIndex ?? "unknown")}`;
        const failed = Boolean(payload.error || payload.errorCode);
        setConversation((items) =>
          items.map((item) =>
            item.id === id && item.type === "tool"
              ? {
                  ...item,
                  result: failed
                    ? payload.error || payload.errorCode
                    : { resultBytes: payload.resultBytes ?? 0 },
                  status: failed ? "error" : "completed",
                }
              : item,
          ),
        );
        break;
      }

      case "agent.tool_denied": {
        const name = typeof payload.tool === "string" ? payload.tool : "tool";
        const id = `tool-denied-${event.seq ?? Date.now()}`;
        setConversation((items) =>
          items.some((item) => item.id === id)
            ? items
            : [
                ...items,
                {
                  id,
                  type: "tool",
                  name,
                  input: {},
                  result: typeof payload.reason === "string" ? payload.reason : "Denied by policy",
                  status: "error",
                  timestamp: Date.now(),
                },
              ],
        );
        break;
      }

      case "agent.approval_requested": {
        const approvalId = typeof payload.approvalId === "string" ? payload.approvalId : "";
        if (!approvalId) break;
        setConversation((items) =>
          items.some((item) => item.type === "approval" && item.approvalId === approvalId)
            ? items
            : [
                ...items,
                {
                  id: `approval-${approvalId}`,
                  type: "approval",
                  approvalId,
                  name: typeof payload.tool === "string" ? payload.tool : "External action",
                  trustTier: typeof payload.trustTier === "string" ? payload.trustTier : "act",
                  input: payload.args ?? {},
                  status: "pending",
                  timestamp: Date.now(),
                },
              ],
        );
        setIsRunProcessing(false);
        setStatus("ready");
        break;
      }

      case "agent.approval_resolved": {
        const approvalId = typeof payload.approvalId === "string" ? payload.approvalId : "";
        const decision = payload.decision === "granted" ? "granted" : "denied";
        setConversation((items) =>
          items.map((item) =>
            item.type === "approval" && item.approvalId === approvalId
              ? { ...item, status: decision }
              : item,
          ),
        );
        setIsRunProcessing(true);
        setStatus("streaming");
        break;
      }

      case "agent.turn_completed":
        setIsRunProcessing(false);
        setStatus("ready");
        break;

      case "agent.turn_failed":
      case "agent.session_failed":
      case "agent.limit_exceeded":
        setChatError(
          typeof payload.error === "string"
            ? friendlyAgentError(payload.error)
            : event.type === "agent.limit_exceeded"
              ? "This run reached its configured limit."
              : "The agent run failed.",
        );
        setIsRunProcessing(false);
        setStatus("error");
        break;

      case "agent.session_completed":
      case "agent.session_canceled":
      case "agent.session_paused":
        setIsRunProcessing(false);
        setStatus("ready");
        break;

      default:
        console.log("Unhandled event type:", event.type);
    }
  }, []);

  // Follow the durable NDJSON session stream. The sequence cursor makes a
  // reconnect gap-free without committing duplicate messages.
  useEffect(() => {
    if (!streamUrl) return;
    const controller = new AbortController();
    streamAbortRef.current = controller;
    let afterSeq = -1;
    let terminal = false;

    const reconnectDelay = () =>
      new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 1_000);
        controller.signal.addEventListener(
          "abort",
          () => {
            window.clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
      });

    const follow = async () => {
      while (!controller.signal.aborted && !terminal) {
        try {
          const cursor = afterSeq >= 0 ? `?afterSeq=${afterSeq}` : "";
          const response = await dashboardFetch(`${streamUrl}${cursor}`, {
            headers: { Accept: "application/x-ndjson" },
            signal: controller.signal,
          });
          if (!response.ok || !response.body) {
            throw new Error(`Agent stream failed (${response.status})`);
          }
          setChatError((current) =>
            current === "Connection to the agent was interrupted. Reconnecting…" ? null : current,
          );
          await readAgentEventStream(response.body, (event) => {
            afterSeq = Math.max(afterSeq, event.seq);
            terminal =
              event.type === "agent.session_completed" ||
              event.type === "agent.session_failed" ||
              event.type === "agent.session_canceled";
            handleEvent(event);
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          console.error("Agent stream interrupted:", error);
          setChatError("Connection to the agent was interrupted. Reconnecting…");
        }
        if (!terminal) await reconnectDelay();
      }
    };

    void follow();

    return () => {
      controller.abort();
      if (streamAbortRef.current === controller) streamAbortRef.current = null;
    };
  }, [handleEvent, streamUrl]);

  const handleSubmit = async (message: PromptInputMessage) => {
    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return;
    }

    let prepared: Awaited<ReturnType<typeof prepareWebChatInput>>;
    try {
      prepared = await prepareWebChatInput(message);
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error("Could not read attachment");
      setChatError(nextError.message);
      setStatus("error");
      setTimeout(() => setStatus("ready"), 2000);
      throw nextError;
    }

    const userMessage = message.text || "";

    // Add user message immediately with unique ID
    const userMessageId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setConversation((prev) => [
      ...prev,
      {
        id: userMessageId,
        type: "message",
        role: "user",
        content: prepared.display,
        timestamp: Date.now(),
      },
    ]);

    setStatus("submitted");
    setChatError(null);
    setText("");

    try {
      let nextRunId = runId;
      if (!nextRunId) {
        const runData = await requestDashboardJson("/agent-sessions/", CreatedAgentSessionSchema, {
          method: "POST",
          body: JSON.stringify({
            agent: selectedAgent,
            input: prepared.input,
            title: prepared.display.slice(0, 120),
            channel: "web",
          }),
        });
        nextRunId = runData.sessionId;
        setRunId(nextRunId);
      } else {
        await requestDashboardJson(
          `/agent-sessions/${encodeURIComponent(nextRunId)}/turns`,
          MutationResponseSchema,
          {
            method: "POST",
            body: JSON.stringify({
              input: prepared.input,
            }),
          },
        );
      }

      setStatus("streaming");
    } catch (error) {
      console.error("Failed to send message:", error);
      setConversation((current) => current.filter((item) => item.id !== userMessageId));
      setText(userMessage);
      setChatError(error instanceof Error ? error.message : "Failed to send message");
      setStatus("error");
      setTimeout(() => setStatus("ready"), 2000);
      throw error;
    }
  };

  const routeContext: DashboardRouteContextValue = {
    chat: {
      workspace,
      processing: isRunProcessing,
      conversation,
      empty: isEmptyConversation,
      promptInput: renderPromptInput(),
      artifact: artifact
        ? {
            ...artifact,
            agentOptions,
            onClose: () => setSelectedResource(null),
          }
        : null,
      onOpenRevenueTab: openRevenueTab,
      onResolveApproval: resolveApproval,
    },
    agents: {
      onAgentsChanged: loadAgentOptions,
      onOpenDefinition: (slug) => {
        setSelectedResource({ kind: "agent", name: slug });
        navigateTo("chat");
      },
      onUseAgent: (slug) => {
        startNewChat();
        setSelectedAgent(slug);
      },
    },
    revenue: {
      tab: revenueTab,
      onTabChange: openRevenueTab,
      onOpenConnectors: () => openSettings("extensions"),
    },
    settings: {
      section: settingsSection,
      session,
      onNavigate: openSettings,
    },
    workflows: {
      focus: workflowFocus,
      selectedResource,
    },
  };

  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-background-50">
      <CommandPalette
        agents={agentOptions}
        onNavigateChat={() => {
          navigateTo("chat");
          setSelectedResource(null);
        }}
        onNavigateRelationship={() => openRevenueTab("relationships")}
        onNewChat={startNewChat}
        onOpenAgent={(name) => {
          navigateTo("chat");
          setSelectedResource({ kind: "agent", name });
        }}
        onOpenSession={openSession}
        onOpenSettings={openSettings}
        onOpenChange={setPaletteOpen}
        onToggleSidebar={toggleSidebar}
        open={paletteOpen}
        sessions={sessions}
      />
      <AppTopBar
        onAsk={() => setPaletteOpen(true)}
        onOpenPeople={() => {
          openRevenueTab("people");
          setSelectedResource(null);
        }}
      />
      {/* The workspace sits in an inset frame under the top bar; phones use the
          full width, where an inset only costs space. */}
      <div className="min-h-0 w-full flex-1 md:px-2.5 md:pb-2.5">
        <section
          className={`relative flex h-full overflow-clip border-t bg-background md:border ${
            view === "settings" ? "settings-workspace" : ""
          }`}
        >
          <AppShellSidebar
            onCloseSettings={() => navigateTo("chat")}
            onNavigateChat={() => {
              navigateTo("chat");
              setSelectedResource(null);
            }}
            onNavigateReport={() => {
              navigateTo("report");
              setSelectedResource(null);
            }}
            onNavigateRevenue={(tab) => {
              openRevenueTab(tab);
              setSelectedResource(null);
            }}
            onNavigateAgents={() => {
              navigateTo("agents");
              setSelectedResource(null);
            }}
            onNavigateScheduled={() => {
              openWorkflows("scheduled");
              setSelectedResource(null);
            }}
            onNavigateRuns={() => {
              openWorkflows("runs");
              setSelectedResource(null);
            }}
            onOpenSettings={openSettings}
            onSelectResource={(resource) => {
              if (resource.kind === "task" || resource.kind === "taskrun") {
                openWorkflows(resource.kind === "taskrun" ? "runs" : "scheduled");
              } else {
                navigateTo("chat");
              }
              setSelectedResource(resource);
            }}
            activeResourceGroup={
              view === "agents" || selectedResource?.kind === "agent"
                ? "agents"
                : view === "workflows"
                  ? workflowFocus
                  : undefined
            }
            activeRevenueTab={revenueTab}
            activeRunId={runId}
            onNewChat={startNewChat}
            onOpenSession={openSession}
            onToggle={toggleSidebar}
            open={sidebarOpen}
            selected={selectedResource}
            sessions={sessions}
            settingsSection={settingsSection}
            user={shellUser}
            billing={session.billing}
            view={view}
          />
          <main
            className={`flex min-w-0 flex-1 flex-col ${
              view === "settings" ? "settings-stage" : ""
            }`}
          >
            <header
              className={
                view === "settings"
                  ? "settings-stage-header"
                  : "flex h-12 shrink-0 items-center px-5"
              }
            >
              <div className="flex items-center gap-2">
                {/* With the sidebar open on a wide screen, its edge and the [ key
                    close it; the button is only needed to bring it back. */}
                <button
                  aria-label="Toggle sidebar"
                  className={`flex size-7 items-center justify-center rounded-none text-primary/60 transition-colors hover:bg-background-100 hover:text-primary dark:hover:bg-background-300 ${
                    sidebarOpen ? "md:hidden" : ""
                  }`}
                  onClick={toggleSidebar}
                  title="Toggle sidebar  ["
                  type="button"
                >
                  <SidebarSimple className="size-4" />
                </button>
                <span
                  className={
                    view === "settings" ? "settings-stage-header-title" : "text-[15px] text-primary"
                  }
                >
                  {view === "settings"
                    ? SETTINGS_SECTIONS.find((s) => s.key === settingsSection)?.label || "Settings"
                    : view === "revenue"
                      ? REVENUE_TAB_LABELS[revenueTab]
                      : view === "report"
                        ? "Open promises"
                        : view === "agents"
                          ? "Agents"
                          : view === "workflows"
                            ? workflowFocus === "runs"
                              ? "Runs"
                              : "Workflows"
                            : "Home"}
                </span>
              </div>
            </header>

            <DashboardRouteProvider value={routeContext}>
              <ViewBoundary viewKey={`${view}:${revenueTab}:${settingsSection}`}>
                {children}
              </ViewBoundary>
            </DashboardRouteProvider>
          </main>
        </section>
      </div>
    </div>
  );
}

export default function ProductDashboardClient({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <div className="app-shell contents" data-product-shell>
        <PageBody>{children}</PageBody>
      </div>
    </AuthGate>
  );
}
