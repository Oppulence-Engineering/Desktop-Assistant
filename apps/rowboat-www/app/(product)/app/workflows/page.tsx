import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { WorkflowsDashboardRoute } from "@/app/(product)/app/workflows/_components/workflows-dashboard-route/workflows-dashboard-route";
import { prefetchWorkflows } from "@/app/(product)/app/workflows/prefetch";
import { workflowSearchParamsCache } from "@/app/(product)/app/workflows/search-params";
import { getQueryClient } from "@/lib/query/get-query-client";

export const instant = false;

export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string | string[] }>;
}) {
  const raw = await searchParams;
  const { focus } = workflowSearchParamsCache.parse({
    focus: Array.isArray(raw.focus) ? raw.focus[0] : raw.focus,
  });
  const queryClient = getQueryClient();
  await prefetchWorkflows(queryClient);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <WorkflowsDashboardRoute focus={focus} />
    </HydrationBoundary>
  );
}
