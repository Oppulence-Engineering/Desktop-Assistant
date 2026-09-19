import { Suspense } from "react";

import { AgentsDashboardRoute } from "@/app/(product)/app/agents/_components/agents-dashboard-route/agents-dashboard-route";
import { prefetchAgents } from "@/app/(product)/app/agents/prefetch";
import { PrefetchHydration } from "@/lib/query/prefetch-hydration";

import AgentsLoading from "./loading";

export default function AgentsPage() {
  return (
    <Suspense fallback={<AgentsLoading />}>
      <PrefetchHydration seed={prefetchAgents}>
        <AgentsDashboardRoute />
      </PrefetchHydration>
    </Suspense>
  );
}
