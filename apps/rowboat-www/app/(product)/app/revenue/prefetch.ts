import type { QueryClient } from "@tanstack/react-query";

import { loadImpact } from "@/hooks/queries/utils/fetch-impact";
import { loadRelationships } from "@/hooks/queries/utils/fetch-relationships";
import { loadRelationshipSourceStatuses } from "@/hooks/queries/utils/fetch-relationship-sources";
import { loadWorkspace } from "@/hooks/queries/utils/fetch-workspace";
import { IMPACT_BUNDLE_STALE_TIME, impactKeys } from "@/hooks/queries/utils/impact-keys";
import {
  RELATIONSHIP_LIST_STALE_TIME,
  relationshipKeys,
} from "@/hooks/queries/utils/relationship-keys";
import {
  RELATIONSHIP_SOURCE_LIST_STALE_TIME,
  relationshipSourceKeys,
} from "@/hooks/queries/utils/relationship-source-keys";
import { WORKSPACE_CURRENT_STALE_TIME, workspaceKeys } from "@/hooks/queries/utils/workspace-keys";
import { requestUpstreamJson } from "@/lib/api/request-json.server";
import { seedQuery } from "@/lib/query/get-query-client";

/**
 * Seed the keys the revenue panel and impact view already read.
 * Talks to Go with the sealed session — never loopbacks through `/api/rowboat`.
 */
export async function prefetchRevenue(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    seedQuery(queryClient, {
      queryKey: relationshipSourceKeys.list(),
      queryFn: ({ signal }) => loadRelationshipSourceStatuses(requestUpstreamJson, signal),
      staleTime: RELATIONSHIP_SOURCE_LIST_STALE_TIME,
    }),
    seedQuery(queryClient, {
      queryKey: workspaceKeys.current(),
      queryFn: ({ signal }) => loadWorkspace(requestUpstreamJson, signal),
      staleTime: WORKSPACE_CURRENT_STALE_TIME,
    }),
    seedQuery(queryClient, {
      queryKey: impactKeys.all,
      queryFn: ({ signal }) => loadImpact(requestUpstreamJson, signal),
      staleTime: IMPACT_BUNDLE_STALE_TIME,
    }),
    seedQuery(queryClient, {
      queryKey: relationshipKeys.list({}),
      queryFn: ({ signal }) => loadRelationships(requestUpstreamJson, {}, signal),
      staleTime: RELATIONSHIP_LIST_STALE_TIME,
    }),
  ]);
}
