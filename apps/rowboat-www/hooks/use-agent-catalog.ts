"use client";

import "client-only";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AgentsResponseSchema, parseAgentsResponse } from "@/lib/agents/agent-schemas";
import { usePref } from "@/lib/console-prefs";
import { requestDashboardJson } from "@/lib/dashboard-json";

function stripExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, "");
}

/**
 * Owns agent discovery and selection. Selection remains an explicit override
 * so changing the persisted default elsewhere does not overwrite a choice
 * made during the current dashboard session.
 */
export function useAgentCatalog() {
  const preferredAgent = usePref("default-agent");
  const [selectedAgentOverride, setSelectedAgent] = useState<string | null>(null);
  const configuredAgent = selectedAgentOverride ?? preferredAgent ?? "assistant";
  const { data: discoveredAgents = [], refetch } = useQuery({
    queryKey: ["dashboard", "agent-options"],
    queryFn: async () => {
      const response = await requestDashboardJson("/agents", AgentsResponseSchema, {
        softFail: true,
      });
      if (!response) return [];
      return parseAgentsResponse(response).map((agent) => stripExtension(agent.slug));
    },
  });
  const agentOptions = useMemo(
    () => Array.from(new Set(["assistant", ...discoveredAgents])),
    [discoveredAgents],
  );
  const selectedAgent = agentOptions.includes(configuredAgent) ? configuredAgent : "assistant";
  const refreshAgents = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    agentOptions,
    refreshAgents,
    selectedAgent,
    setSelectedAgent,
  };
}
