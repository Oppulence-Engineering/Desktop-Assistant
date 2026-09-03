export type AgentStreamEvent = {
  seq: number;
  type: string;
  turnSeq?: number;
  data: Record<string, unknown>;
};

function parseAgentStreamEvent(line: string): AgentStreamEvent {
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid agent stream event");
  }
  const event = value as Record<string, unknown>;
  if (
    !Number.isInteger(event.seq) ||
    (event.seq as number) < 0 ||
    typeof event.type !== "string" ||
    !event.data ||
    typeof event.data !== "object" ||
    Array.isArray(event.data)
  ) {
    throw new Error("Invalid agent stream event");
  }
  if (event.turnSeq !== undefined && !Number.isInteger(event.turnSeq)) {
    throw new Error("Invalid agent stream event");
  }
  return event as AgentStreamEvent;
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
