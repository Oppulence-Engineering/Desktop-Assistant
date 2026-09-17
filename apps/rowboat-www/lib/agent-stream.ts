import { z } from "zod";

export const AgentStreamEventSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    type: z.string().min(1),
    turnSeq: z.number().int().nonnegative().nullish(),
    data: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export type AgentStreamEvent = z.infer<typeof AgentStreamEventSchema>;

const RunStateEventSchema = AgentStreamEventSchema.extend({
  type: z.enum([
    "agent.session_started",
    "agent.turn_started",
    "agent.llm_call_started",
    "agent.turn_completed",
    "agent.session_completed",
    "agent.session_canceled",
    "agent.session_paused",
  ]),
  data: z.object({ input: z.string().optional().catch(undefined) }).passthrough(),
});

const AgentMessageEventSchema = AgentStreamEventSchema.extend({
  type: z.literal("agent.message"),
  data: z.object({ content: z.string().optional().catch(undefined) }).passthrough(),
});

const ToolStartedEventSchema = AgentStreamEventSchema.extend({
  type: z.literal("agent.tool_call_started"),
  data: z
    .object({
      callIndex: z.unknown().optional(),
      tool: z.string().catch("tool"),
    })
    .passthrough(),
});

const ToolCompletedEventSchema = AgentStreamEventSchema.extend({
  type: z.literal("agent.tool_call_completed"),
  data: z
    .object({
      callIndex: z.unknown().optional(),
      error: z.unknown().optional(),
      errorCode: z.unknown().optional(),
      resultBytes: z.unknown().optional(),
    })
    .passthrough(),
});

const ToolDeniedEventSchema = AgentStreamEventSchema.extend({
  type: z.literal("agent.tool_denied"),
  data: z
    .object({
      reason: z.string().catch("Denied by policy"),
      tool: z.string().catch("tool"),
    })
    .passthrough(),
});

const ApprovalRequestedEventSchema = AgentStreamEventSchema.extend({
  type: z.literal("agent.approval_requested"),
  data: z
    .object({
      approvalId: z.string().optional().catch(undefined),
      args: z.unknown().optional(),
      tool: z.string().catch("External action"),
      trustTier: z.string().catch("act"),
    })
    .passthrough(),
});

const ApprovalResolvedEventSchema = AgentStreamEventSchema.extend({
  type: z.literal("agent.approval_resolved"),
  data: z
    .object({
      approvalId: z.string().optional().catch(undefined),
      decision: z
        .unknown()
        .transform((value): "granted" | "denied" => (value === "granted" ? "granted" : "denied")),
    })
    .passthrough(),
});

const FailureEventSchema = AgentStreamEventSchema.extend({
  type: z.enum(["agent.turn_failed", "agent.session_failed", "agent.limit_exceeded"]),
  data: z.object({ error: z.string().optional().catch(undefined) }).passthrough(),
});

export type KnownAgentStreamEvent =
  | z.infer<typeof RunStateEventSchema>
  | z.infer<typeof AgentMessageEventSchema>
  | z.infer<typeof ToolStartedEventSchema>
  | z.infer<typeof ToolCompletedEventSchema>
  | z.infer<typeof ToolDeniedEventSchema>
  | z.infer<typeof ApprovalRequestedEventSchema>
  | z.infer<typeof ApprovalResolvedEventSchema>
  | z.infer<typeof FailureEventSchema>;

/**
 * Validates event-specific payloads before lifecycle code consumes them.
 * Unknown event types remain forward-compatible and are intentionally ignored.
 */
export function parseKnownAgentStreamEvent(event: AgentStreamEvent): KnownAgentStreamEvent | null {
  switch (event.type) {
    case "agent.session_started":
    case "agent.turn_started":
    case "agent.llm_call_started":
    case "agent.turn_completed":
    case "agent.session_completed":
    case "agent.session_canceled":
    case "agent.session_paused":
      return RunStateEventSchema.parse(event);
    case "agent.message":
      return AgentMessageEventSchema.parse(event);
    case "agent.tool_call_started":
      return ToolStartedEventSchema.parse(event);
    case "agent.tool_call_completed":
      return ToolCompletedEventSchema.parse(event);
    case "agent.tool_denied":
      return ToolDeniedEventSchema.parse(event);
    case "agent.approval_requested":
      return ApprovalRequestedEventSchema.parse(event);
    case "agent.approval_resolved":
      return ApprovalResolvedEventSchema.parse(event);
    case "agent.turn_failed":
    case "agent.session_failed":
    case "agent.limit_exceeded":
      return FailureEventSchema.parse(event);
    default:
      return null;
  }
}

function parseAgentStreamEvent(line: string): AgentStreamEvent {
  const value: unknown = JSON.parse(line);
  return AgentStreamEventSchema.parse(value);
}

export async function readAgentEventStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) onEvent(parseAgentStreamEvent(line));
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(parseAgentStreamEvent(buffer));
}
