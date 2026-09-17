import type { DurableAgentSessionEvent } from "@/lib/api/generated/client/model/durableAgentSessionEvent";
import type { DurableAgentSessionView } from "@/lib/api/generated/client/model/durableAgentSessionView";
import {
  ListAgentSessionEvents200Response,
  ListAgentSessions200Response,
} from "@/lib/api/generated/zod/agent-sessions/agent-sessions";

export type AgentSessionSummary = Pick<
  DurableAgentSessionView,
  "sessionId" | "agent" | "title" | "createdAt" | "lastActivityAt"
>;

export function friendlyAgentError(message: string): string {
  if (/openrouter_credits|upstream_credits_exhausted|upstream provider account/i.test(message)) {
    return "Oppulence's AI provider is temporarily unavailable. Your workspace credits were not charged. Try again later.";
  }
  if (
    /status 402|requires more credits|insufficient_credits|credits_exhausted|out of (?:AI )?credits/i.test(
      message,
    )
  ) {
    return "This workspace is out of AI credits. Ask an administrator to add credits, then try again.";
  }
  if (/activity error|scheduledEventID|startedEventID/i.test(message)) {
    return "The agent could not complete this request. Please try again.";
  }
  return message;
}

export function parseAgentSessionsResponse(value: unknown): AgentSessionSummary[] {
  return ListAgentSessions200Response.parse(value).sessions.map(
    ({ sessionId, agent, title, createdAt, lastActivityAt }) => ({
      sessionId,
      agent,
      title,
      createdAt,
      lastActivityAt,
    }),
  );
}

export function parseAgentSessionEventsResponse(value: unknown): {
  events: DurableAgentSessionEvent[];
  nextSeq?: number | null;
} {
  return ListAgentSessionEvents200Response.parse(value);
}

export type AgentHistoryItem =
  | {
      id: string;
      type: "message";
      role: "user" | "assistant";
      content: string;
      timestamp: number;
    }
  | {
      id: string;
      type: "tool";
      name: string;
      input: unknown;
      result?: unknown;
      status: "pending" | "running" | "completed" | "error";
      timestamp: number;
    }
  | {
      id: string;
      type: "approval";
      approvalId: string;
      name: string;
      trustTier: string;
      input: unknown;
      status: "pending" | "resolving" | "granted" | "denied";
      timestamp: number;
    };

export type ApprovalRequest = Extract<AgentHistoryItem, { type: "approval" }>;

export type ReasoningBlock = {
  id: string;
  type: "reasoning";
  content: string;
  isStreaming: boolean;
  timestamp: number;
};

export type ConversationItem = AgentHistoryItem | ReasoningBlock;

export function conversationFromAgentEvents(
  events: DurableAgentSessionEvent[],
): AgentHistoryItem[] {
  const items: AgentHistoryItem[] = [];
  for (const event of events) {
    const data = event.data;
    if (event.type === "agent.turn_started" && typeof data.input === "string") {
      items.push({
        id: `user-event-${event.seq}`,
        type: "message",
        role: "user",
        content: data.input,
        timestamp: Date.now(),
      });
    } else if (event.type === "agent.message" && typeof data.content === "string") {
      items.push({
        id: `assistant-${event.seq}`,
        type: "message",
        role: "assistant",
        content: data.content,
        timestamp: Date.now(),
      });
    } else if (event.type === "agent.tool_call_started") {
      items.push({
        id: `tool-${event.turnSeq ?? "unknown"}-${String(data.callIndex ?? "unknown")}`,
        type: "tool",
        name: typeof data.tool === "string" ? data.tool : "tool",
        input: {},
        status: "running",
        timestamp: Date.now(),
      });
    } else if (event.type === "agent.tool_call_completed") {
      const id = `tool-${event.turnSeq ?? "unknown"}-${String(data.callIndex ?? "unknown")}`;
      const failed = Boolean(data.error || data.errorCode);
      const tool = items.find((item) => item.type === "tool" && item.id === id);
      if (tool?.type === "tool") {
        tool.result = failed
          ? data.error || data.errorCode
          : { resultBytes: data.resultBytes ?? 0 };
        tool.status = failed ? "error" : "completed";
      }
    } else if (event.type === "agent.tool_denied") {
      items.push({
        id: `tool-denied-${event.seq}`,
        type: "tool",
        name: typeof data.tool === "string" ? data.tool : "tool",
        input: {},
        result: typeof data.reason === "string" ? data.reason : "Denied by policy",
        status: "error",
        timestamp: Date.now(),
      });
    } else if (event.type === "agent.approval_requested" && typeof data.approvalId === "string") {
      items.push({
        id: `approval-${data.approvalId}`,
        type: "approval",
        approvalId: data.approvalId,
        name: typeof data.tool === "string" ? data.tool : "External action",
        trustTier: typeof data.trustTier === "string" ? data.trustTier : "act",
        input: data.args ?? {},
        status: "pending",
        timestamp: Date.now(),
      });
    } else if (event.type === "agent.approval_resolved" && typeof data.approvalId === "string") {
      const approval = items.find(
        (item) => item.type === "approval" && item.approvalId === data.approvalId,
      );
      if (approval?.type === "approval") {
        approval.status = data.decision === "granted" ? "granted" : "denied";
      }
    }
  }
  return items;
}
