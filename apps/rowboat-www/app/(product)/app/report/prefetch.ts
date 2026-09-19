import type { QueryClient } from "@tanstack/react-query";

import {
  loadOpenPromisesReport,
  loadReportScan,
  loadReportScans,
} from "@/hooks/queries/utils/fetch-report";
import { loadRelationshipSourceStatuses } from "@/hooks/queries/utils/fetch-relationship-sources";
import {
  RELATIONSHIP_SOURCE_LIST_STALE_TIME,
  relationshipSourceKeys,
} from "@/hooks/queries/utils/relationship-source-keys";
import {
  REPORT_DOCUMENT_STALE_TIME,
  REPORT_SCAN_DETAIL_STALE_TIME,
  REPORT_SCAN_LIST_STALE_TIME,
  reportKeys,
} from "@/hooks/queries/utils/report-keys";
import { requestUpstreamJson } from "@/lib/api/request-json.server";
import { seedQuery } from "@/lib/query/get-query-client";

/**
 * Seed the same keys and staleTimes the report client hooks use.
 * Talks to Go with the sealed session — never loopbacks through `/api/rowboat`.
 */
export async function prefetchReport(
  queryClient: QueryClient,
  scanId: string | null,
): Promise<void> {
  await Promise.all([
    seedQuery(queryClient, {
      queryKey: relationshipSourceKeys.list(),
      queryFn: ({ signal }) => loadRelationshipSourceStatuses(requestUpstreamJson, signal),
      staleTime: RELATIONSHIP_SOURCE_LIST_STALE_TIME,
    }),
    seedQuery(queryClient, {
      queryKey: reportKeys.scanList(),
      queryFn: ({ signal }) => loadReportScans(requestUpstreamJson, signal),
      staleTime: REPORT_SCAN_LIST_STALE_TIME,
    }),
  ]);

  if (!scanId) return;

  await Promise.all([
    seedQuery(queryClient, {
      queryKey: reportKeys.scan(scanId),
      queryFn: ({ signal }) => loadReportScan(requestUpstreamJson, scanId, signal),
      staleTime: REPORT_SCAN_DETAIL_STALE_TIME,
    }),
    seedQuery(queryClient, {
      queryKey: reportKeys.document(scanId),
      queryFn: ({ signal }) => loadOpenPromisesReport(requestUpstreamJson, scanId, signal),
      staleTime: REPORT_DOCUMENT_STALE_TIME,
    }),
  ]);
}
