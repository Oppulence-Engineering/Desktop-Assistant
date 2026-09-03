import { describe, expect, it } from "vitest";

import { readAgentEventStream } from "@/lib/agent-stream";

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
});
