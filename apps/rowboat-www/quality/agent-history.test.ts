import { describe, expect, it } from "vitest";

import {
  conversationFromAgentEvents,
  parseAgentSessionEventsResponse,
  parseAgentSessionsResponse,
} from "@/lib/agent-history";

describe("conversationFromAgentEvents", () => {
  it("reconstructs durable messages, tools, and approvals", () => {
    const items = conversationFromAgentEvents([
      { seq: 1, type: "agent.turn_started", turnSeq: 1, data: { input: "Review Acme" } },
      {
        seq: 2,
        type: "agent.tool_call_started",
        turnSeq: 1,
        data: { callIndex: 0, tool: "crm.lookup" },
      },
      {
        seq: 3,
        type: "agent.tool_call_completed",
        turnSeq: 1,
        data: { callIndex: 0, tool: "crm.lookup", resultBytes: 42 },
      },
      {
        seq: 4,
        type: "agent.approval_requested",
        turnSeq: 1,
        data: { approvalId: "approval-1", tool: "slack.post", trustTier: "act" },
      },
      {
        seq: 5,
        type: "agent.approval_resolved",
        turnSeq: 1,
        data: { approvalId: "approval-1", decision: "granted" },
      },
      { seq: 6, type: "agent.message", turnSeq: 1, data: { content: "Acme is healthy." } },
    ]);

    expect(
      items.map((item) => [item.type, item.type === "message" ? item.role : item.status]),
    ).toEqual([
      ["message", "user"],
      ["tool", "completed"],
      ["approval", "granted"],
      ["message", "assistant"],
    ]);
  });

  it("validates durable history responses at the API boundary", () => {
    expect(
      parseAgentSessionsResponse({
        sessions: [
          {
            sessionId: "session-1",
            agent: "assistant",
            title: null,
            createdAt: "2026-09-02T12:00:00Z",
            lastActivityAt: null,
          },
        ],
      }),
    ).toHaveLength(1);
    expect(
      parseAgentSessionEventsResponse({
        events: [{ seq: 0, type: "agent.message", data: { content: "Done" } }],
        nextSeq: null,
      }).events,
    ).toHaveLength(1);
    expect(() => parseAgentSessionsResponse({ sessions: [{ sessionId: 1 }] })).toThrow();
  });
});
