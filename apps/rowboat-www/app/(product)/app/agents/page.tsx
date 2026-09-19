import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { AgentsDashboardRoute } from "@/app/(product)/app/agents/_components/agents-dashboard-route/agents-dashboard-route";
import { prefetchAgents } from "@/app/(product)/app/agents/prefetch";
import { getQueryClient } from "@/lib/query/get-query-client";

export const instant = false;

export default async function AgentsPage() {
  const queryClient = getQueryClient();
  await prefetchAgents(queryClient);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AgentsDashboardRoute />
    </HydrationBoundary>
  );
}
