import type { DurableAgentSessionEvent } from "@/lib/api/generated/client/model/durableAgentSessionEvent";
import type { DurableAgentSessionView } from "@/lib/api/generated/client/model/durableAgentSessionView";

export type AgentSessionSummary = Pick<
  DurableAgentSessionView,
  "sessionId" | "agent" | "title" | "createdAt" | "lastActivityAt"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseAgentSessionsResponse(value: unknown): AgentSessionSummary[] {
  if (!isRecord(value) || !Array.isArray(value.sessions)) {
    throw new Error("Invalid agent sessions response");
  }
  return value.sessions.map((session) => {
    if (
      !isRecord(session) ||
      typeof session.sessionId !== "string" ||
      typeof session.agent !== "string" ||
      (session.title != null && typeof session.title !== "string") ||
      typeof session.createdAt !== "string" ||
      !Number.isFinite(Date.parse(session.createdAt)) ||
      (session.lastActivityAt != null &&
        (typeof session.lastActivityAt !== "string" ||
          !Number.isFinite(Date.parse(session.lastActivityAt))))
    ) {
      throw new Error("Invalid agent sessions response");
    }
    return {
      sessionId: session.sessionId,
      agent: session.agent,
      title: session.title,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
    };
  });
}

export function parseAgentSessionEventsResponse(value: unknown): {
  events: DurableAgentSessionEvent[];
  nextSeq?: number | null;
} {
  if (!isRecord(value) || !Array.isArray(value.events)) {
    throw new Error("Invalid agent session events response");
  }
  const events = value.events.map((event) => {
    if (
      !isRecord(event) ||
      !Number.isInteger(event.seq) ||
      (event.seq as number) < 0 ||
      typeof event.type !== "string" ||
      !isRecord(event.data) ||
      (event.turnSeq != null && !Number.isInteger(event.turnSeq))
    ) {
      throw new Error("Invalid agent session events response");
    }
    return {
      seq: event.seq as number,
      type: event.type,
      data: event.data,
      turnSeq: event.turnSeq as number | null | undefined,
    };
  });
  if (value.nextSeq != null && !Number.isInteger(value.nextSeq)) {
    throw new Error("Invalid agent session events response");
  }
  return { events, nextSeq: value.nextSeq as number | null | undefined };
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
