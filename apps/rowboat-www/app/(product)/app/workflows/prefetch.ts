import type { QueryClient } from "@tanstack/react-query";

import { loadWorkflowTasks } from "@/hooks/queries/utils/fetch-workflows";
import { WORKFLOW_LIST_STALE_TIME, workflowKeys } from "@/hooks/queries/utils/workflow-keys";
import { requestUpstreamJson } from "@/lib/api/request-json.server";
import { seedQuery } from "@/lib/query/get-query-client";

export async function prefetchWorkflows(queryClient: QueryClient): Promise<void> {
  await seedQuery(queryClient, {
    queryKey: workflowKeys.tasks(),
    queryFn: ({ signal }) => loadWorkflowTasks(requestUpstreamJson, signal),
    staleTime: WORKFLOW_LIST_STALE_TIME,
  });
}
