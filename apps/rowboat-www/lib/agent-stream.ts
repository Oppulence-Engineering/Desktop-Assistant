import { z } from "zod";

export const AgentStreamEventSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    type: z.string().min(1),
    turnSeq: z.number().int().nonnegative().optional(),
    data: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export type AgentStreamEvent = z.infer<typeof AgentStreamEventSchema>;

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
