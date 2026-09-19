"use client";

import "client-only";

import { useQuery } from "@tanstack/react-query";

import { fetchAgentSummaries } from "@/hooks/queries/utils/fetch-agents";
import { AGENT_LIST_STALE_TIME, agentKeys } from "@/hooks/queries/utils/agent-keys";

function stripExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, "");
}

export function useAgentSummaries() {
  return useQuery({
    queryKey: agentKeys.summaries(),
    queryFn: ({ signal }) => fetchAgentSummaries(signal),
    staleTime: AGENT_LIST_STALE_TIME,
  });
}

export function useAgentSlugs() {
  return useQuery({
    queryKey: agentKeys.summaries(),
    queryFn: ({ signal }) => fetchAgentSummaries(signal),
    staleTime: AGENT_LIST_STALE_TIME,
    select: (agents) => agents.map((agent) => stripExtension(agent.slug)),
  });
}
