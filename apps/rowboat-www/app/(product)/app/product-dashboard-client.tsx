"use client";

import dynamic from "next/dynamic";

import { AppShellSidebar, SETTINGS_SECTIONS, type SettingsSection } from "@/components/app-shell";
import { AgentConfigurationForm } from "@/components/agents/agent-configuration-form";
import { AuthGate, useAuthSession } from "@/components/auth-gate";
import { CommandPalette } from "@/components/command-palette";
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
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Reasoning, ReasoningTrigger, ReasoningContent } from "@/components/ai-elements/reasoning";
import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactClose,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";
import { useState, useEffect, useRef, type ReactNode, useCallback, useMemo } from "react";
import { CircleNotch, FloppyDisk, LockSimple, SidebarSimple } from "@phosphor-icons/react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@oppulence/ui/components/select";
import { JsonEditor } from "@/components/json-editor";
import { TiptapMarkdownEditor } from "@/components/tiptap-markdown-editor";
import { MarkdownViewer } from "@/components/markdown-viewer";
import { Button } from "@oppulence/ui/components/button";
import { dashboardFetch, toDashboardAPIPath } from "@/lib/auth/client";
import { readAgentEventStream } from "@/lib/agent-stream";
import {
  conversationFromAgentEvents,
  parseAgentSessionEventsResponse,
  parseAgentSessionsResponse,
  type AgentHistoryItem,
} from "@/lib/agent-history";
import type { DurableAgentSessionEvent } from "@/lib/api/generated/client/model/durableAgentSessionEvent";
import { getPref } from "@/lib/console-prefs";
import {
  prepareWebChatInput,
  WEB_CHAT_ACCEPT,
  WEB_CHAT_MAX_FILE_BYTES,
  WEB_CHAT_MAX_FILES,
} from "@/lib/chat-attachments";
import {
  PRODUCT_VIEW_PATHS,
  productViewForPathname,
  type ProductView,
} from "@/lib/product-navigation";
import {
  listSessions,
  loadSession,
  saveSession,
  type SessionMeta,
  type SessionScope,
} from "@/lib/chat-sessions";

const AgentsView = dynamic(() =>
  import("@/components/agents/agents-view").then((module) => module.AgentsView),
);
const CloudWorkflowsView = dynamic(() =>
  import("@/components/workflows/cloud-workflows-view").then((module) => module.CloudWorkflowsView),
);
const RevenuePanel = dynamic(() =>
  import("@/components/revenue-panel").then((module) => module.RevenuePanel),
);
const SettingsView = dynamic(() =>
  import("@/components/app-settings").then((module) => module.SettingsView),
);

type ChatMessage = Extract<AgentHistoryItem, { type: "message" }>;
type ToolCall = Extract<AgentHistoryItem, { type: "tool" }>;

interface ReasoningBlock {
  id: string;
  type: "reasoning";
  content: string;
  isStreaming: boolean;
  timestamp: number;
}

type ApprovalRequest = Extract<AgentHistoryItem, { type: "approval" }>;

type ConversationItem = AgentHistoryItem | ReasoningBlock;

type ResourceKind = "agent" | "config" | "run" | "task" | "taskrun";

type SelectedResource = {
  kind: ResourceKind;
  name: string;
};

type ToolCallContentPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  arguments: unknown;
};

type RunEvent = {
  type: string;
  seq?: number;
  turnSeq?: number;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

function mergeSessionLists(...lists: SessionMeta[][]): SessionMeta[] {
  return [
    ...new Map(
      lists
        .flat()
        .sort((left, right) => left.updatedAt - right.updatedAt)
        .map((session) => [session.runId, session] as const),
    ).values(),
  ].sort((left, right) => right.updatedAt - left.updatedAt);
}

function agentViewToDocument(value: unknown, fallbackSlug: string): Record<string, unknown> {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const slug = typeof record.slug === "string" && record.slug ? record.slug : fallbackSlug;
  const name = typeof record.name === "string" && record.name ? record.name : slug;
  const tools = Array.isArray(record.enabledTools)
    ? record.enabledTools.filter((tool): tool is string => typeof tool === "string")
    : [];
  const subagents = Array.isArray(record.subagentRefs)
    ? record.subagentRefs.filter((agent): agent is string => typeof agent === "string")
    : [];
  const connections = Array.isArray(record.connectorReqs)
    ? record.connectorReqs
        .filter((scope): scope is string => typeof scope === "string")
        .map((scope) => ({ scope }))
    : [];
  const spec: Record<string, unknown> = {
    instructions: typeof record.instructions === "string" ? record.instructions : "",
    tools,
  };
  if (typeof record.model === "string" && record.model) spec.model = record.model;
  if (typeof record.provider === "string" && record.provider) spec.provider = record.provider;
  if (subagents.length) spec.subagents = subagents;
  if (connections.length) spec.connections = connections;
  if (record.limits && typeof record.limits === "object") spec.limits = record.limits;
  return {
    apiVersion: "agent.rowboat.dev/v1",
    kind: "Agent",
    metadata: { slug, name },
    spec,
  };
}

function PageBody({ initialView }: { initialView: ProductView }) {
  const session = useAuthSession();
  const sessionScope = useMemo<SessionScope>(
    () => ({
      organizationId: session.user.organizationId,
      userId: session.user.id ?? session.user.workosUserId ?? session.user.email ?? "unknown-user",
    }),
    [session.user.email, session.user.id, session.user.organizationId, session.user.workosUserId],
  );
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
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState<string>("");
  const [currentReasoning, setCurrentReasoning] = useState<string>("");
  const streamAbortRef = useRef<AbortController | null>(null);
  const committedMessageIds = useRef<Set<string>>(new Set());
  const isEmptyConversation =
    conversation.length === 0 && !currentAssistantMessage && !currentReasoning;
  const [selectedResource, setSelectedResource] = useState<SelectedResource | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [view, setView] = useState<ProductView>(initialView);
  const [workflowFocus, setWorkflowFocus] = useState<"scheduled" | "runs">("scheduled");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("overview");
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [agentOptions, setAgentOptions] = useState<string[]>(["assistant"]);
  const [selectedAgent, setSelectedAgent] = useState<string>("assistant");

  const navigateTo = useCallback((nextView: ProductView) => {
    setView(nextView);
    const nextPath = PRODUCT_VIEW_PATHS[nextView];
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => setView(productViewForPathname(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSessions(listSessions(sessionScope));
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
        if (!cancelled) setSessions((current) => mergeSessionLists(current, remote));
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
    setSessions((current) => mergeSessionLists(listSessions(sessionScope), current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, conversation]);

  const startNewChat = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    committedMessageIds.current = new Set();
    setRunId(null);
    setConversation([]);
    setCurrentAssistantMessage("");
    setCurrentReasoning("");
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
      setCurrentAssistantMessage("");
      setCurrentReasoning("");
      setChatError(null);

      try {
        let items = stored?.items as ConversationItem[] | undefined;
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

  useEffect(() => {
    const saved = localStorage.getItem("app-sidebar-open");
    if (saved !== null) setSidebarOpen(saved === "1");
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      localStorage.setItem("app-sidebar-open", open ? "0" : "1");
      return !open;
    });
  }, []);

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
  const [artifactTitle, setArtifactTitle] = useState("");
  const [artifactSubtitle, setArtifactSubtitle] = useState("");
  const [artifactText, setArtifactText] = useState("");
  const [artifactOriginal, setArtifactOriginal] = useState("");
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [artifactReadOnly, setArtifactReadOnly] = useState(false);
  const [artifactFileType, setArtifactFileType] = useState<"json" | "markdown">("json");
  useEffect(() => {
    const preferred = getPref("default-agent");
    if (preferred) setSelectedAgent(preferred);
  }, []);

  const artifactDirty = !artifactReadOnly && artifactText !== artifactOriginal;
  const stripExtension = (name: string) => name.replace(/\.[^/.]+$/, "");
  const detectFileType = (name: string): "json" | "markdown" =>
    name.toLowerCase().match(/\.(md|markdown)$/) ? "markdown" : "json";

  const requestJson = useCallback(
    async (url: string, options?: (RequestInit & { allow404?: boolean }) | undefined) => {
      const fullUrl = toDashboardAPIPath(url);
      const { allow404, ...rest } = options || {};
      const res = await dashboardFetch(fullUrl, {
        ...rest,
        headers: {
          "Content-Type": "application/json",
          ...(rest.headers || {}),
        },
      });

      const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
      const isJson = contentType.includes("application/json");
      const text = await res.text();

      if (!res.ok) {
        if (res.status === 404 && allow404) return null;
        if (isJson) {
          let errMsg = "";
          try {
            const errObj = JSON.parse(text);
            errMsg =
              typeof errObj === "string"
                ? errObj
                : errObj?.message || errObj?.error || JSON.stringify(errObj);
          } catch {
            // Fall through when the response body is not valid JSON.
          }
          if (errMsg) throw new Error(String(errMsg));
        }
        if (res.status === 404) {
          throw new Error("Resource not found on the CLI backend (404)");
        }
        throw new Error(`Request failed: ${res.status} ${res.statusText}`);
      }

      if (!text) return null;
      if (!isJson) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
    [],
  );

  const stopRun = async () => {
    if (!runId) return;
    setStatus("submitted");
    try {
      await requestJson(`/agent-sessions/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
      });
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      setRunId(null);
      setCurrentAssistantMessage("");
      setCurrentReasoning("");
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
        const token = await requestJson(
          `/agent-sessions/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approval.approvalId)}/token`,
          { method: "POST" },
        );
        approvalToken = token?.approvalToken;
        if (!approvalToken) throw new Error("The approval token could not be created");
      }
      await requestJson(
        `/agent-sessions/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approval.approvalId)}`,
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
            placeholder="Ask Oppulence"
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
  const handleEvent = useCallback((event: RunEvent) => {
    console.log("Event received:", event.type, event);
    const payload = event.data ?? event;

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
        setCurrentAssistantMessage("");
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
            ? payload.error
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

      case "run-processing-start":
        setIsRunProcessing(true);
        setStatus((prev) => (prev === "error" ? prev : "streaming"));
        break;

      case "run-processing-end":
        setIsRunProcessing(false);
        setStatus("ready");
        break;

      case "start":
        setStatus("streaming");
        setCurrentAssistantMessage("");
        setCurrentReasoning("");
        break;

      case "llm-stream-event":
        {
          const llmEvent =
            (event.event as {
              type?: string;
              delta?: string;
              toolCallId?: string;
              toolName?: string;
              input?: unknown;
            }) || {};
          console.log("LLM stream event type:", llmEvent.type);

          if (llmEvent.type === "reasoning-delta" && llmEvent.delta) {
            setCurrentReasoning((prev) => prev + llmEvent.delta);
          } else if (llmEvent.type === "reasoning-end") {
            // Commit reasoning block if we have content
            setCurrentReasoning((reasoning) => {
              if (reasoning) {
                setConversation((prev) => [
                  ...prev,
                  {
                    id: `reasoning-${Date.now()}`,
                    type: "reasoning",
                    content: reasoning,
                    isStreaming: false,
                    timestamp: Date.now(),
                  },
                ]);
              }
              return "";
            });
          } else if (llmEvent.type === "text-delta" && llmEvent.delta) {
            setCurrentAssistantMessage((prev) => prev + llmEvent.delta);
            setStatus("streaming");
          } else if (llmEvent.type === "text-end") {
            console.log("TEXT END received - waiting for message event");
          } else if (llmEvent.type === "tool-call") {
            // Add tool call to conversation immediately
            setConversation((prev) => [
              ...prev,
              {
                id: llmEvent.toolCallId || `tool-${Date.now()}`,
                type: "tool",
                name: llmEvent.toolName || "tool",
                input: llmEvent.input,
                status: "running",
                timestamp: Date.now(),
              },
            ]);
          } else if (llmEvent.type === "finish-step") {
            console.log("FINISH STEP received - waiting for message event");
          }
        }
        break;

      case "message": {
        console.log("MESSAGE event received:", event);
        const message = (event.message as { role?: string; content?: unknown }) || {};
        if (message.role !== "assistant") {
          break;
        }

        if (Array.isArray(message.content)) {
          const toolCalls = message.content.filter(
            (part): part is ToolCallContentPart =>
              (part as ToolCallContentPart)?.type === "tool-call",
          );
          if (toolCalls.length) {
            setConversation((prev) => {
              let updated: ConversationItem[] = prev.map((item) => {
                if (item.type !== "tool") return item;
                const match = toolCalls.find((part) => part.toolCallId === item.id);
                return match
                  ? {
                      ...item,
                      name: match.toolName,
                      input: match.arguments,
                      status: "pending",
                    }
                  : item;
              });

              for (const part of toolCalls) {
                const exists = updated.some(
                  (item) => item.type === "tool" && item.id === part.toolCallId,
                );
                if (!exists) {
                  updated = [
                    ...updated,
                    {
                      id: part.toolCallId,
                      type: "tool",
                      name: part.toolName,
                      input: part.arguments,
                      status: "pending",
                      timestamp: Date.now(),
                    },
                  ];
                }
              }
              return updated;
            });
          }
        }

        const messageId =
          typeof event.messageId === "string" ? event.messageId : `assistant-${Date.now()}`;

        if (committedMessageIds.current.has(messageId)) {
          console.log("⚠️ Message already committed, skipping:", messageId);
          break;
        }

        committedMessageIds.current.add(messageId);

        setCurrentAssistantMessage((currentMsg) => {
          console.log("✅ Committing message:", messageId, currentMsg);
          if (currentMsg) {
            setConversation((prev) => {
              const exists = prev.some((m) => m.id === messageId);
              if (exists) {
                console.log("⚠️ Message ID already in array, skipping:", messageId);
                return prev;
              }
              return [
                ...prev,
                {
                  id: messageId,
                  type: "message",
                  role: "assistant",
                  content: currentMsg,
                  timestamp: Date.now(),
                },
              ];
            });
          }
          return "";
        });
        setStatus("ready");
        console.log("Status set to ready");
        break;
      }

      case "tool-invocation":
        setConversation((prev) =>
          prev.map((item) =>
            item.type === "tool" && (item.id === event.toolCallId || item.name === event.toolName)
              ? { ...item, status: "running" as const }
              : item,
          ),
        );
        break;

      case "tool-result":
        setConversation((prev) =>
          prev.map((item) =>
            item.type === "tool" && (item.id === event.toolCallId || item.name === event.toolName)
              ? { ...item, result: event.result, status: "completed" as const }
              : item,
          ),
        );
        break;

      case "error":
        // Only set error status for actual errors, not connection issues
        {
          const errorMsg = typeof event.error === "string" ? event.error : "";
          if (errorMsg && !errorMsg.includes("terminated")) {
            setStatus("error");
            console.error("Agent error:", errorMsg);
          } else {
            console.log("Connection error (will auto-reconnect):", errorMsg);
            setStatus("ready");
          }
          setIsRunProcessing(false);
        }
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
        const runData = await requestJson("/agent-sessions/", {
          method: "POST",
          body: JSON.stringify({
            agent: selectedAgent,
            input: prepared.input,
            title: prepared.display.slice(0, 120),
            channel: "web",
          }),
        });
        nextRunId = runData?.sessionId || runData?.id;
        setRunId(nextRunId);
      } else {
        await requestJson(`/agent-sessions/${encodeURIComponent(nextRunId)}/turns`, {
          method: "POST",
          body: JSON.stringify({
            input: prepared.input,
          }),
        });
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

  useEffect(() => {
    if (!selectedResource) return;
    let cancelled = false;
    const load = async () => {
      setArtifactLoading(true);
      setArtifactError(null);
      try {
        const title = selectedResource.name;
        let subtitle = "";
        let text = "";
        let readOnly = false;
        const detectedType = detectFileType(selectedResource.name);
        setArtifactFileType(detectedType);

        if (selectedResource.kind === "agent") {
          const raw = selectedResource.name;
          const isMarkdown = /\.(md|markdown)$/i.test(raw);

          if (isMarkdown) {
            subtitle = "Agent (Markdown)";
            const response = await dashboardFetch(
              `/api/rowboat/v1/agents/${encodeURIComponent(stripExtension(raw) || raw)}?format=yaml`,
            );
            if (!response.ok) {
              if (response.status === 404) {
                text = "";
              } else {
                throw new Error(`Failed to load agent file: ${response.status}`);
              }
            } else {
              const data = await response.json();
              text = data?.content || data?.raw || "";
            }
            setArtifactFileType("markdown");
          } else {
            const id = stripExtension(raw) || raw;
            const data = await requestJson(`/agents/${encodeURIComponent(id)}`);

            const source =
              data && typeof data === "object" && typeof data.source === "string"
                ? data.source
                : "";
            readOnly = source === "builtin" || source === "gitops";
            subtitle = readOnly ? `${source || "Managed"} agent` : "Agent definition";
            text = JSON.stringify(agentViewToDocument(data, id), null, 2);
            setArtifactFileType("json");
          }
        } else if (selectedResource.kind === "config") {
          const lower = selectedResource.name.toLowerCase();
          if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
            // Load markdown file as plain text from local API
            try {
              const response = await dashboardFetch(
                `/api/rowboat/config?file=${encodeURIComponent(selectedResource.name)}`,
              );
              if (!response.ok) {
                if (response.status === 404) {
                  // File doesn't exist, start with empty content
                  text = "";
                } else {
                  throw new Error(`Failed to load markdown file: ${response.status}`);
                }
              } else {
                const data = await response.json();
                text = data.content || data.raw || "";
              }
              subtitle = "Markdown";
              setArtifactFileType("markdown");
            } catch (error: unknown) {
              const err = error as Error;
              console.error("Error loading markdown file:", error);
              // Show error but still allow editing
              setArtifactError(err?.message || "Failed to load markdown file");
              text = "";
              subtitle = "Markdown";
              setArtifactFileType("markdown");
            }
          } else if (lower.includes("mcp")) {
            const data = await requestJson("/mcp");
            subtitle = "MCP config";
            text = JSON.stringify(data ?? {}, null, 2);
            setArtifactFileType("json");
          } else if (lower.includes("model")) {
            const data = await requestJson("/models");
            subtitle = "Models config";
            text = JSON.stringify(data ?? {}, null, 2);
            setArtifactFileType("json");
          } else {
            // Try to load as JSON by default
            try {
              const data = await requestJson(
                `/config/${encodeURIComponent(selectedResource.name)}`,
              );
              subtitle = "Config";
              text = JSON.stringify(data ?? {}, null, 2);
              setArtifactFileType("json");
            } catch {
              throw new Error("Unsupported config file");
            }
          }
        } else if (selectedResource.kind === "task") {
          subtitle = "Background task";
          readOnly = true;
          const data = await requestJson(
            `/background-tasks/${encodeURIComponent(selectedResource.name)}`,
          );
          text = JSON.stringify(data ?? {}, null, 2);
          setArtifactFileType("json");
        } else if (selectedResource.kind === "taskrun") {
          subtitle = "Task run (read-only)";
          readOnly = true;
          const [slug, ...rest] = selectedResource.name.split("/");
          const taskRunId = rest.join("/");
          const data = await requestJson(
            `/background-tasks/${encodeURIComponent(slug)}/runs/${encodeURIComponent(taskRunId)}`,
          );
          text = JSON.stringify(data ?? {}, null, 2);
          setArtifactFileType("json");
        } else if (selectedResource.kind === "run") {
          subtitle = "Run (read-only)";
          readOnly = true;
          setArtifactFileType(detectedType);

          const local = await requestJson(
            `/api/rowboat/run?file=${encodeURIComponent(selectedResource.name)}`,
          );
          if (local?.parsed) {
            text = JSON.stringify(local.parsed, null, 2);
          } else if (local?.raw) {
            text = local.raw;
          } else {
            text = "";
          }
        }

        if (cancelled) return;
        setArtifactTitle(title);
        setArtifactSubtitle(subtitle);
        setArtifactText(text);
        setArtifactOriginal(text);
        setArtifactReadOnly(readOnly);
      } catch (error: unknown) {
        if (!cancelled) {
          const err = error as Error;
          setArtifactError(err?.message || "Failed to load resource");
          setArtifactText("");
        }
      } finally {
        if (!cancelled) {
          setArtifactLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedResource, requestJson]);

  const loadAgentOptions = useCallback(async () => {
    try {
      const res = await dashboardFetch("/api/rowboat/v1/agents");
      if (!res.ok) return;
      const data = await res.json();
      const agents = Array.isArray(data.agents)
        ? data.agents
            .map((a: { slug?: string } | string) =>
              typeof a === "string" ? stripExtension(a) : a.slug,
            )
            .filter((agent: string | undefined): agent is string => Boolean(agent))
        : [];
      const options = Array.from(new Set(["assistant", ...agents]));
      setAgentOptions(options);
      setSelectedAgent((current) => (options.includes(current) ? current : "assistant"));
    } catch (error) {
      console.error("Failed to load agent list", error);
    }
  }, []);

  useEffect(() => {
    void loadAgentOptions();
  }, [loadAgentOptions]);

  const handleSave = async () => {
    if (!selectedResource || artifactReadOnly || !artifactDirty) return;
    setArtifactLoading(true);
    setArtifactError(null);
    try {
      if (selectedResource.kind === "agent") {
        if (artifactFileType === "markdown") {
          const response = await dashboardFetch(
            `/api/rowboat/agent?file=${encodeURIComponent(selectedResource.name)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "text/plain" },
              body: artifactText,
            },
          );
          if (!response.ok) {
            throw new Error("Failed to save agent file");
          }
          setArtifactOriginal(artifactText);
        } else {
          const parsed = JSON.parse(artifactText);
          const raw = selectedResource.name;
          const targetId = stripExtension(raw) || raw;

          await requestJson(`/agents/${encodeURIComponent(targetId)}`, {
            method: "PUT",
            body: JSON.stringify(parsed),
          });
          setArtifactOriginal(JSON.stringify(parsed, null, 2));
        }
      } else if (selectedResource.kind === "config") {
        const lower = selectedResource.name.toLowerCase();

        if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
          // Save markdown file as plain text via local API
          const response = await dashboardFetch(
            `/api/rowboat/config?file=${encodeURIComponent(selectedResource.name)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "text/plain" },
              body: artifactText,
            },
          );
          if (!response.ok) {
            throw new Error("Failed to save markdown file");
          }
          setArtifactOriginal(artifactText);
        } else {
          // Handle JSON config files
          const parsed = JSON.parse(artifactText);
          const previous = artifactOriginal ? JSON.parse(artifactOriginal) : {};

          if (lower.includes("model")) {
            const newProviders = parsed.providers || {};
            const oldProviders = previous.providers || {};
            const toDelete = Object.keys(oldProviders).filter(
              (name) => !Object.prototype.hasOwnProperty.call(newProviders, name),
            );
            for (const name of toDelete) {
              await requestJson(`/models/providers/${encodeURIComponent(name)}`, {
                method: "DELETE",
              });
            }
            for (const name of Object.keys(newProviders)) {
              await requestJson(`/models/providers/${encodeURIComponent(name)}`, {
                method: "PUT",
                body: JSON.stringify(newProviders[name]),
              });
            }
            if (parsed.defaults) {
              await requestJson("/models/default", {
                method: "PUT",
                body: JSON.stringify(parsed.defaults),
              });
            }
          } else if (lower.includes("mcp")) {
            const newServers = parsed.mcpServers || parsed || {};
            const oldServers = previous.mcpServers || {};
            const toDelete = Object.keys(oldServers).filter(
              (name) => !Object.prototype.hasOwnProperty.call(newServers, name),
            );
            for (const name of toDelete) {
              await requestJson(`/mcp/${encodeURIComponent(name)}`, {
                method: "DELETE",
              });
            }
            for (const name of Object.keys(newServers)) {
              await requestJson(`/mcp/${encodeURIComponent(name)}`, {
                method: "PUT",
                body: JSON.stringify(newServers[name]),
              });
            }
          } else {
            throw new Error("Unsupported config file");
          }
          setArtifactOriginal(JSON.stringify(parsed, null, 2));
        }
      }
    } catch (error: unknown) {
      const err = error as Error;
      setArtifactError(err?.message || "Failed to save changes");
    } finally {
      setArtifactLoading(false);
    }
  };

  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-background">
      <CommandPalette
        agents={agentOptions}
        onNavigateChat={() => {
          navigateTo("chat");
          setSelectedResource(null);
        }}
        onNewChat={startNewChat}
        onOpenAgent={(name) => {
          navigateTo("chat");
          setSelectedResource({ kind: "agent", name });
        }}
        onOpenSession={openSession}
        onOpenSettings={(section) => {
          setSettingsSection(section);
          navigateTo("settings");
        }}
        onOpenChange={setPaletteOpen}
        onToggleSidebar={toggleSidebar}
        open={paletteOpen}
        sessions={sessions}
      />
      <div className="min-h-0 w-full flex-1">
        <section
          className={`relative flex h-full overflow-clip bg-background ${
            view === "settings" ? "settings-workspace" : ""
          }`}
        >
          <AppShellSidebar
            onCloseSettings={() => navigateTo("chat")}
            onNavigateChat={() => {
              navigateTo("chat");
              setSelectedResource(null);
            }}
            onNavigateRevenue={() => {
              navigateTo("revenue");
              setSelectedResource(null);
            }}
            onNavigateAgents={() => {
              navigateTo("agents");
              setSelectedResource(null);
            }}
            onNavigateScheduled={() => {
              setWorkflowFocus("scheduled");
              navigateTo("workflows");
              setSelectedResource(null);
            }}
            onNavigateRuns={() => {
              setWorkflowFocus("runs");
              navigateTo("workflows");
              setSelectedResource(null);
            }}
            onOpenSettings={(section) => {
              setSettingsSection(section);
              navigateTo("settings");
            }}
            onSelectResource={(resource) => {
              if (resource.kind === "task") setWorkflowFocus("scheduled");
              if (resource.kind === "taskrun") setWorkflowFocus("runs");
              navigateTo(
                resource.kind === "task" || resource.kind === "taskrun" ? "workflows" : "chat",
              );
              setSelectedResource(resource);
            }}
            activeResourceGroup={
              view === "agents" || selectedResource?.kind === "agent"
                ? "agents"
                : view === "workflows"
                  ? workflowFocus
                  : undefined
            }
            activeRunId={runId}
            onNewChat={startNewChat}
            onOpenSession={openSession}
            onToggle={toggleSidebar}
            open={sidebarOpen}
            selected={selectedResource}
            sessions={sessions}
            settingsSection={settingsSection}
            user={{
              name: session.user.email || session.user.workosUserId || "User",
              email: session.user.email || session.user.workosUserId || "",
              avatar: "",
            }}
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
                  : "flex h-12 shrink-0 items-center justify-between border-b px-4"
              }
            >
              <div className="flex items-center gap-2">
                <button
                  aria-label="Toggle sidebar"
                  className="flex size-7 items-center justify-center rounded-md text-primary/60 transition-colors hover:bg-background-100 hover:text-primary dark:hover:bg-background-300"
                  onClick={toggleSidebar}
                  title="Toggle sidebar  ["
                  type="button"
                >
                  <SidebarSimple className="size-4" />
                </button>
                <span
                  className={
                    view === "settings"
                      ? "settings-stage-header-title"
                      : "text-sm font-medium text-primary"
                  }
                >
                  {view === "settings"
                    ? SETTINGS_SECTIONS.find((s) => s.key === settingsSection)?.label || "Settings"
                    : view === "revenue"
                      ? "Relationships"
                      : view === "agents"
                        ? "Agents"
                        : view === "workflows"
                          ? workflowFocus === "runs"
                            ? "Runs"
                            : "Scheduled"
                          : "Chat"}
                </span>
              </div>
              {view !== "settings" ? (
                <button
                  className="hidden rounded-md border border-border/70 px-2 py-1 font-mono text-[11px] text-primary/45 transition-colors hover:bg-background-100 hover:text-primary md:block dark:hover:bg-background-200"
                  onClick={() => setPaletteOpen(true)}
                  title="Command palette"
                  type="button"
                >
                  ⌘K
                </button>
              ) : null}
            </header>

            {view === "settings" ? (
              <SettingsView
                onNavigate={setSettingsSection}
                section={settingsSection}
                session={session}
              />
            ) : view === "revenue" ? (
              <div className="flex-1 overflow-y-auto">
                <RevenuePanel
                  onOpenConnectors={() => {
                    setSettingsSection("extensions");
                    navigateTo("settings");
                  }}
                />
              </div>
            ) : view === "agents" ? (
              <AgentsView
                onAgentsChanged={loadAgentOptions}
                onOpenDefinition={(slug) => {
                  setSelectedResource({ kind: "agent", name: slug });
                  navigateTo("chat");
                }}
                onUseAgent={(slug) => {
                  startNewChat();
                  setSelectedAgent(slug);
                }}
              />
            ) : view === "workflows" ? (
              <CloudWorkflowsView
                key={
                  selectedResource?.kind === "task" || selectedResource?.kind === "taskrun"
                    ? `${workflowFocus}:${selectedResource.name}`
                    : workflowFocus
                }
                focus={workflowFocus}
                initialRunId={
                  selectedResource?.kind === "taskrun"
                    ? selectedResource.name.split("/").slice(1).join("/")
                    : undefined
                }
                initialSlug={
                  selectedResource?.kind === "task"
                    ? selectedResource.name
                    : selectedResource?.kind === "taskrun"
                      ? selectedResource.name.split("/")[0]
                      : undefined
                }
              />
            ) : (
              <div className="flex flex-1 flex-col gap-4 overflow-hidden px-4 pb-0 md:flex-row">
                <div className="relative flex flex-1 min-w-0 flex-col overflow-hidden">
                  {isRunProcessing && (
                    <div className="pointer-events-none absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-primary/70 shadow-sm">
                      <CircleNotch className="h-3.5 w-3.5 animate-spin" />
                      <span>Working…</span>
                    </div>
                  )}
                  {/* Messages area */}
                  <Conversation className="flex-1 min-h-0 overflow-y-auto">
                    {!isEmptyConversation && (
                      <div className="pointer-events-none sticky bottom-0 z-10 h-16 bg-gradient-to-t from-background via-background/80 to-transparent" />
                    )}
                    <ConversationContent className="!flex !flex-col !items-center !gap-8 !p-4 pt-4 pb-32">
                      <div className="w-full max-w-3xl mx-auto space-y-4">
                        {/* Render conversation items in order */}
                        {conversation.map((item) => {
                          if (item.type === "message") {
                            return (
                              <Message key={item.id} from={item.role}>
                                <MessageContent>
                                  <MessageResponse>{item.content}</MessageResponse>
                                </MessageContent>
                              </Message>
                            );
                          } else if (item.type === "tool") {
                            const stateMap: Record<
                              ToolCall["status"],
                              | "input-streaming"
                              | "input-available"
                              | "output-available"
                              | "output-error"
                            > = {
                              pending: "input-streaming",
                              running: "input-available",
                              completed: "output-available",
                              error: "output-error",
                            };

                            return (
                              <div key={item.id} className="mb-2">
                                <Tool>
                                  <ToolHeader
                                    title={item.name}
                                    type="tool-call"
                                    state={stateMap[item.status] || "input-streaming"}
                                  />
                                  <ToolContent>
                                    <ToolInput input={item.input} />
                                    {item.result != null && (
                                      <ToolOutput
                                        output={item.result as ReactNode}
                                        errorText={undefined}
                                      />
                                    )}
                                  </ToolContent>
                                </Tool>
                              </div>
                            );
                          } else if (item.type === "reasoning") {
                            return (
                              <div key={item.id} className="mb-2">
                                <Reasoning isStreaming={item.isStreaming}>
                                  <ReasoningTrigger />
                                  <ReasoningContent>{item.content}</ReasoningContent>
                                </Reasoning>
                              </div>
                            );
                          } else if (item.type === "approval") {
                            return (
                              <div
                                className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
                                key={item.id}
                              >
                                <p className="text-sm font-medium text-primary">
                                  Approval required: {item.name}
                                </p>
                                <p className="mt-1 text-xs text-primary/55">
                                  Trust tier: {item.trustTier.replaceAll("_", " ")}
                                </p>
                                <div className="mt-3">
                                  <ToolInput input={item.input} />
                                </div>
                                {item.status === "pending" ? (
                                  <div className="mt-3 flex gap-2">
                                    <Button
                                      onClick={() => void resolveApproval(item, "granted")}
                                      size="sm"
                                    >
                                      Approve
                                    </Button>
                                    <Button
                                      onClick={() => void resolveApproval(item, "denied")}
                                      size="sm"
                                      variant="outline"
                                    >
                                      Deny
                                    </Button>
                                  </div>
                                ) : (
                                  <p className="mt-3 text-xs capitalize text-primary/60">
                                    {item.status === "resolving"
                                      ? "Submitting decision…"
                                      : item.status}
                                  </p>
                                )}
                              </div>
                            );
                          }
                          return null;
                        })}

                        {/* Streaming reasoning */}
                        {currentReasoning && (
                          <div className="mb-2">
                            <Reasoning isStreaming={true}>
                              <ReasoningTrigger />
                              <ReasoningContent>{currentReasoning}</ReasoningContent>
                            </Reasoning>
                          </div>
                        )}

                        {/* Streaming message */}
                        {currentAssistantMessage && (
                          <Message from="assistant">
                            <MessageContent>
                              <MessageResponse>{currentAssistantMessage}</MessageResponse>
                              <span className="inline-block w-2 h-4 ml-1 bg-oppulence-orange animate-pulse" />
                            </MessageContent>
                          </Message>
                        )}
                      </div>
                    </ConversationContent>
                  </Conversation>

                  {/* Input area */}
                  {isEmptyConversation ? (
                    <div className="absolute inset-0 flex items-center justify-center px-4 pb-16">
                      <div className="w-full max-w-3xl space-y-6 text-center">
                        <h1 className="text-2xl font-medium tracking-tight text-foreground">
                          What can I help with?
                        </h1>
                        {renderPromptInput()}
                      </div>
                    </div>
                  ) : (
                    <div className="w-full px-4 pb-5 pt-2">
                      <div className="w-full max-w-3xl mx-auto">{renderPromptInput()}</div>
                    </div>
                  )}
                </div>

                {selectedResource && (
                  <div className="flex w-full flex-col md:w-[70%] md:max-w-4xl md:shrink-0 min-h-[260px] md:min-h-0 py-5">
                    <Artifact className="flex-1 min-h-0 h-full">
                      <ArtifactHeader>
                        <div className="flex flex-col">
                          <ArtifactTitle className="truncate">{artifactTitle}</ArtifactTitle>
                          <ArtifactDescription className="text-xs">
                            {artifactSubtitle || selectedResource.kind}
                            {artifactReadOnly && (
                              <span className="ml-2 inline-flex items-center gap-1 text-muted-foreground">
                                <LockSimple className="h-3 w-3" /> Read-only
                              </span>
                            )}
                          </ArtifactDescription>
                        </div>
                        <ArtifactActions>
                          {!artifactReadOnly && (
                            <ArtifactAction
                              className="w-auto gap-1.5 px-3"
                              tooltip={artifactDirty ? "Save changes" : "Saved"}
                              disabled={!artifactDirty || artifactLoading}
                              onClick={handleSave}
                            >
                              {artifactLoading ? (
                                <CircleNotch className="h-4 w-4 animate-spin" />
                              ) : (
                                <FloppyDisk className="h-4 w-4" />
                              )}
                              <span>{artifactDirty ? "Save changes" : "Saved"}</span>
                            </ArtifactAction>
                          )}
                          <ArtifactClose onClick={() => setSelectedResource(null)} />
                        </ArtifactActions>
                      </ArtifactHeader>
                      <ArtifactContent className="bg-muted/30">
                        {artifactLoading ? (
                          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                            <CircleNotch className="mr-2 h-4 w-4 animate-spin" /> Loading
                          </div>
                        ) : artifactError ? (
                          <div className="text-sm text-red-500 whitespace-pre-wrap break-words">
                            {artifactError}
                          </div>
                        ) : (
                          <div className="flex h-full flex-col gap-2">
                            {selectedResource.kind === "agent" && artifactFileType === "json" ? (
                              <AgentConfigurationForm
                                agentSlugs={agentOptions}
                                content={artifactText}
                                onChange={setArtifactText}
                                readOnly={artifactReadOnly}
                              />
                            ) : artifactReadOnly ? (
                              artifactFileType === "markdown" ? (
                                <MarkdownViewer content={artifactText} />
                              ) : (
                                <pre className="h-full min-h-[240px] max-h-[70vh] w-full overflow-auto whitespace-pre-wrap rounded-none border bg-background p-4 font-mono text-sm leading-relaxed text-foreground">
                                  {artifactText}
                                </pre>
                              )
                            ) : artifactFileType === "markdown" ? (
                              <TiptapMarkdownEditor
                                content={artifactText}
                                onChange={(newContent) => setArtifactText(newContent)}
                                readOnly={false}
                                placeholder="Start writing your markdown..."
                              />
                            ) : (
                              <JsonEditor
                                content={artifactText}
                                onChange={(newContent) => setArtifactText(newContent)}
                                readOnly={false}
                              />
                            )}
                            {artifactReadOnly && (
                              <p className="text-xs text-muted-foreground">
                                {selectedResource.kind === "agent"
                                  ? "This managed agent can be viewed here but cannot be changed from the workspace."
                                  : "Runs are read-only; use the API to replay or inspect in detail."}
                              </p>
                            )}
                          </div>
                        )}
                      </ArtifactContent>
                    </Artifact>
                  </div>
                )}
              </div>
            )}
          </main>
        </section>
      </div>
    </div>
  );
}

export default function ProductDashboardClient({
  initialView = "chat",
}: {
  initialView?: ProductView;
}) {
  return (
    <AuthGate>
      <div className="app-shell contents" data-product-shell>
        <PageBody initialView={initialView} />
      </div>
    </AuthGate>
  );
}
