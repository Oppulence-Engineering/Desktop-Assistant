import {
  AgentsResponseSchema,
  parseAgentsResponse,
  type AgentSummary,
} from "@/lib/agents/agent-schemas";
import { isOptionalRequestFailure, requestJson, type RequestJsonFn } from "@/lib/api/request-json";

const AGENTS_PATH = "/agents";

export async function loadAgentSummaries(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<AgentSummary[]> {
  try {
    const body = await request({
      path: AGENTS_PATH,
      schema: AgentsResponseSchema,
      signal,
    });
    return parseAgentsResponse(body);
  } catch (error) {
    if (isOptionalRequestFailure(error)) return [];
    throw error;
  }
}

export function fetchAgentSummaries(signal?: AbortSignal): Promise<AgentSummary[]> {
  return loadAgentSummaries(requestJson, signal);
}

function stripExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, "");
}

export async function loadAgentSlugs(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<string[]> {
  return (await loadAgentSummaries(request, signal)).map((agent) => stripExtension(agent.slug));
}

export function fetchAgentSlugs(signal?: AbortSignal): Promise<string[]> {
  return loadAgentSlugs(requestJson, signal);
}
