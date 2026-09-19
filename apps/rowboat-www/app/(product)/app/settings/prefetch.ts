import type { QueryClient } from "@tanstack/react-query";

import { loadConnectors } from "@/hooks/queries/utils/fetch-connectors";
import { loadConsolePreferences } from "@/hooks/queries/utils/fetch-console";
import { CONNECTOR_LIST_STALE_TIME, connectorKeys } from "@/hooks/queries/utils/connector-keys";
import { CONSOLE_PREFERENCES_STALE_TIME, consoleKeys } from "@/hooks/queries/utils/console-keys";
import { requestUpstreamJson } from "@/lib/api/request-json.server";
import { seedQuery } from "@/lib/query/get-query-client";

export async function prefetchSettings(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    seedQuery(queryClient, {
      queryKey: consoleKeys.preferences(),
      queryFn: ({ signal }) => loadConsolePreferences(requestUpstreamJson, signal),
      staleTime: CONSOLE_PREFERENCES_STALE_TIME,
    }),
    seedQuery(queryClient, {
      queryKey: connectorKeys.list(),
      queryFn: ({ signal }) => loadConnectors(requestUpstreamJson, signal),
      staleTime: CONNECTOR_LIST_STALE_TIME,
    }),
  ]);
}
