import { describe, expect, it } from "vitest";

import { parseAgentDocument, parseAgentsResponse } from "@/lib/agents/agent-schemas";

describe("agent schemas", () => {
  it("validates and normalizes agent list responses", () => {
    expect(
      parseAgentsResponse({
        agents: [
          "assistant",
          {
            slug: "renewal-reviewer",
            name: "Renewal reviewer",
            enabledTools: ["crm.lookup"],
          },
        ],
      }),
    ).toEqual([
      {
        slug: "assistant",
        name: "assistant",
        source: "unknown",
        enabledTools: [],
        subagentRefs: [],
        connectorReqs: [],
      },
      {
        slug: "renewal-reviewer",
        name: "Renewal reviewer",
        source: "unknown",
        enabledTools: ["crm.lookup"],
        subagentRefs: [],
        connectorReqs: [],
      },
    ]);
    expect(() => parseAgentsResponse({ agents: [{ name: "Missing slug" }] })).toThrow();
  });

  it("rejects malformed projection fields before creating an editor document", () => {
    expect(() =>
      parseAgentDocument(
        {
          slug: "assistant",
          enabledTools: ["crm.lookup", 42],
        },
        "fallback",
      ),
    ).toThrow();
  });
});
