import type { DurableAgentSessionEvent } from "@/lib/api/generated/client/model/durableAgentSessionEvent";
import type { DurableAgentSessionView } from "@/lib/api/generated/client/model/durableAgentSessionView";
import {
  ListAgentSessionEvents200Response,
  ListAgentSessions200Response,
} from "@/lib/api/generated/zod/agent-sessions/agent-sessions";
import {
  AgentStreamEventSchema,
  parseKnownAgentStreamEvent,
  type KnownAgentStreamEvent,
} from "@/lib/agent-stream";

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

function toolEventId(event: KnownAgentStreamEvent): string {
  return `tool-${event.turnSeq ?? "unknown"}-${String(event.data.callIndex ?? "unknown")}`;
}

/** Applies one validated transcript event without mutating existing state. */
export function applyAgentEvent(
  items: AgentHistoryItem[],
  event: KnownAgentStreamEvent,
  now?: number,
): AgentHistoryItem[];
export function applyAgentEvent(
  items: ConversationItem[],
  event: KnownAgentStreamEvent,
  now?: number,
): ConversationItem[];
export function applyAgentEvent(
  items: ConversationItem[],
  event: KnownAgentStreamEvent,
  now = Date.now(),
): ConversationItem[] {
  switch (event.type) {
    case "agent.message": {
      const content = event.data.content;
      const id = `assistant-${event.seq}`;
      if (!content || items.some((item) => item.id === id)) return items;
      return [...items, { id, type: "message", role: "assistant", content, timestamp: now }];
    }
    case "agent.tool_call_started": {
      const id = toolEventId(event);
      if (items.some((item) => item.id === id)) {
        return items.map((item) =>
          item.id === id && item.type === "tool" ? { ...item, status: "running" } : item,
        );
      }
      return [
        ...items,
        {
          id,
          type: "tool",
          name: event.data.tool,
          input: {},
          status: "running",
          timestamp: now,
        },
      ];
    }
    case "agent.tool_call_completed": {
      const id = toolEventId(event);
      const failed = Boolean(event.data.error || event.data.errorCode);
      return items.map((item) =>
        item.id === id && item.type === "tool"
          ? {
              ...item,
              result: failed
                ? event.data.error || event.data.errorCode
                : { resultBytes: event.data.resultBytes ?? 0 },
              status: failed ? "error" : "completed",
            }
          : item,
      );
    }
    case "agent.tool_denied": {
      const id = `tool-denied-${event.seq}`;
      if (items.some((item) => item.id === id)) return items;
      return [
        ...items,
        {
          id,
          type: "tool",
          name: event.data.tool,
          input: {},
          result: event.data.reason,
          status: "error",
          timestamp: now,
        },
      ];
    }
    case "agent.approval_requested": {
      const approvalId = event.data.approvalId;
      if (
        !approvalId ||
        items.some((item) => item.type === "approval" && item.approvalId === approvalId)
      ) {
        return items;
      }
      return [
        ...items,
        {
          id: `approval-${approvalId}`,
          type: "approval",
          approvalId,
          name: event.data.tool,
          trustTier: event.data.trustTier,
          input: event.data.args ?? {},
          status: "pending",
          timestamp: now,
        },
      ];
    }
    case "agent.approval_resolved": {
      const approvalId = event.data.approvalId;
      if (!approvalId) return items;
      return items.map((item) =>
        item.type === "approval" && item.approvalId === approvalId
          ? { ...item, status: event.data.decision }
          : item,
      );
    }
    default:
      return items;
  }
}

export function conversationFromAgentEvents(
  events: DurableAgentSessionEvent[],
): AgentHistoryItem[] {
  let items: AgentHistoryItem[] = [];
  for (const rawEvent of events) {
    const event = parseKnownAgentStreamEvent(AgentStreamEventSchema.parse(rawEvent));
    if (!event) continue;

    if (event.type === "agent.turn_started" && event.data.input) {
      items = [
        ...items,
        {
          id: `user-event-${event.seq}`,
          type: "message",
          role: "user",
          content: event.data.input,
          timestamp: Date.now(),
        },
      ];
    } else {
      items = applyAgentEvent(items, event);
    }
  }
  return items;
}
