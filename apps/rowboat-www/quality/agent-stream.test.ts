import { describe, expect, it } from "vitest";

import { applyAgentEvent } from "@/lib/agent-history";
import {
  AgentStreamEventSchema,
  parseKnownAgentStreamEvent,
  readAgentEventStream,
  type KnownAgentStreamEvent,
} from "@/lib/agent-stream";

function parseKnown(value: unknown): KnownAgentStreamEvent {
  const event = parseKnownAgentStreamEvent(AgentStreamEventSchema.parse(value));
  if (!event) throw new Error("Expected a known agent event");
  return event;
}

describe("agent event stream", () => {
  it("reads chunked NDJSON events without losing split lines", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('{"seq":0,"type":"agent.turn_started","data":{"turn":0}}\n{"seq"'),
        );
        controller.enqueue(
          encoder.encode(':1,"type":"agent.message","turnSeq":0,"data":{"content":"Done"}}'),
        );
        controller.close();
      },
    });
    const events: string[] = [];

    await readAgentEventStream(stream, (event) =>
      events.push(`${String(event.seq)}:${event.type}`),
    );

    expect(events).toEqual(["0:agent.turn_started", "1:agent.message"]);
  });

  it("validates known payloads and ignores duplicate transcript events", () => {
    const event = parseKnown({
      seq: 4,
      type: "agent.message",
      data: { content: "Done" },
    });
    const once = applyAgentEvent([], event, 100);
    const twice = applyAgentEvent(once, event, 200);

    expect(twice).toBe(once);
    expect(twice).toEqual([
      {
        id: "assistant-4",
        type: "message",
        role: "assistant",
        content: "Done",
        timestamp: 100,
      },
    ]);
    const malformed = parseKnown({
      seq: 5,
      type: "agent.message",
      data: { content: 42 },
    });
    expect(applyAgentEvent(twice, malformed, 300)).toBe(twice);
  });

  it("normalizes approval payload defaults at the event boundary", () => {
    const event = parseKnown({
      seq: 7,
      type: "agent.approval_requested",
      data: { approvalId: "approval-7", tool: 42 },
    });

    expect(applyAgentEvent([], event, 300)).toMatchObject([
      {
        approvalId: "approval-7",
        name: "External action",
        trustTier: "act",
        status: "pending",
      },
    ]);
  });
});
