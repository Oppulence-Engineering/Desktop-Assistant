import { z } from "zod";

const NonEmptyStringSchema = z.string().trim().min(1);

export const AgentViewSchema = z
  .object({
    slug: NonEmptyStringSchema.optional(),
    name: NonEmptyStringSchema.optional(),
    source: z.string().optional(),
    instructions: z.string().optional(),
    model: NonEmptyStringSchema.optional(),
    provider: NonEmptyStringSchema.optional(),
    enabledTools: z.array(z.string()).default([]),
    subagentRefs: z.array(z.string()).default([]),
    connectorReqs: z.array(z.string()).default([]),
    limits: z.record(z.string(), z.unknown()).optional(),
  })
  .strip();

export type AgentView = z.infer<typeof AgentViewSchema>;

const AgentListEntrySchema = AgentViewSchema.extend({
  slug: NonEmptyStringSchema,
});

export const AgentsResponseSchema = z.object({
  agents: z.array(z.union([NonEmptyStringSchema, AgentListEntrySchema])),
});

export type AgentSummary = {
  slug: string;
  name: string;
  source: string;
  instructions?: string;
  model?: string;
  provider?: string;
  enabledTools: string[];
  subagentRefs: string[];
  connectorReqs: string[];
  limits?: Record<string, unknown>;
};

/** Validates and normalizes the list projection returned by the agents API. */
export function parseAgentsResponse(value: unknown): AgentSummary[] {
  return AgentsResponseSchema.parse(value).agents.map((agent) => {
    if (typeof agent === "string") {
      return {
        slug: agent,
        name: agent,
        source: "unknown",
        enabledTools: [],
        subagentRefs: [],
        connectorReqs: [],
      };
    }

    return {
      ...agent,
      name: agent.name ?? agent.slug,
      source: agent.source ?? "unknown",
      enabledTools: agent.enabledTools ?? [],
      subagentRefs: agent.subagentRefs ?? [],
      connectorReqs: agent.connectorReqs ?? [],
    };
  });
}

/**
 * Converts the API's agent projection into the editable Agent document shape.
 * Defaults are deliberate because managed/legacy projections may omit fields;
 * malformed field types are rejected instead of leaking into the editor.
 */
export function parseAgentDocument(value: unknown, fallbackSlug: string): Record<string, unknown> {
  const agent = AgentViewSchema.parse(value);
  const slug = agent.slug ?? fallbackSlug;
  const name = agent.name ?? slug;
  const spec: Record<string, unknown> = {
    instructions: agent.instructions ?? "",
    tools: agent.enabledTools ?? [],
  };

  if (agent.model) spec.model = agent.model;
  if (agent.provider) spec.provider = agent.provider;
  if (agent.subagentRefs?.length) spec.subagents = agent.subagentRefs;
  if (agent.connectorReqs?.length) {
    spec.connections = agent.connectorReqs.map((scope) => ({ scope }));
  }
  if (agent.limits) spec.limits = agent.limits;

  return {
    apiVersion: "agent.rowboat.dev/v1",
    kind: "Agent",
    metadata: { slug, name },
    spec,
  };
}
