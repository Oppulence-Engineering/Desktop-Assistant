import type { QueryClient } from "@tanstack/react-query";

import { loadAgentSummaries } from "@/hooks/queries/utils/fetch-agents";
import { AGENT_LIST_STALE_TIME, agentKeys } from "@/hooks/queries/utils/agent-keys";
import { requestUpstreamJson } from "@/lib/api/request-json.server";
import { seedQuery } from "@/lib/query/get-query-client";

export async function prefetchAgents(queryClient: QueryClient): Promise<void> {
  await seedQuery(queryClient, {
    queryKey: agentKeys.summaries(),
    queryFn: ({ signal }) => loadAgentSummaries(requestUpstreamJson, signal),
    staleTime: AGENT_LIST_STALE_TIME,
  });
}
