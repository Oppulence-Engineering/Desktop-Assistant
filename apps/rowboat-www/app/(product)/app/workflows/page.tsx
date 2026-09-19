import { Suspense } from "react";

import { WorkflowsDashboardRoute } from "@/app/(product)/app/workflows/_components/workflows-dashboard-route/workflows-dashboard-route";
import { prefetchWorkflows } from "@/app/(product)/app/workflows/prefetch";
import { workflowSearchParamsCache } from "@/app/(product)/app/workflows/search-params";
import { PrefetchHydration } from "@/lib/query/prefetch-hydration";

import WorkflowsLoading from "./loading";

type WorkflowsPageProps = {
  searchParams: Promise<{ focus?: string | string[] }>;
};

export default function WorkflowsPage({ searchParams }: WorkflowsPageProps) {
  return (
    <Suspense fallback={<WorkflowsLoading />}>
      <WorkflowsRouteContent searchParams={searchParams} />
    </Suspense>
  );
}

async function WorkflowsRouteContent({ searchParams }: WorkflowsPageProps) {
  const raw = await searchParams;
  const { focus } = workflowSearchParamsCache.parse({
    focus: Array.isArray(raw.focus) ? raw.focus[0] : raw.focus,
  });
  return (
    <PrefetchHydration seed={prefetchWorkflows}>
      <WorkflowsDashboardRoute focus={focus} />
    </PrefetchHydration>
  );
}
