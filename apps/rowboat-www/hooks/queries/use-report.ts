"use client";

import "client-only";

import { useQuery } from "@tanstack/react-query";

import {
  fetchOpenPromisesReport,
  fetchReportScan,
  fetchReportScans,
} from "@/hooks/queries/utils/fetch-report";
import {
  REPORT_DOCUMENT_STALE_TIME,
  REPORT_SCAN_DETAIL_STALE_TIME,
  REPORT_SCAN_LIST_STALE_TIME,
  reportKeys,
} from "@/hooks/queries/utils/report-keys";

export function useReportScanList() {
  return useQuery({
    queryKey: reportKeys.scanList(),
    queryFn: ({ signal }) => fetchReportScans(signal),
    staleTime: REPORT_SCAN_LIST_STALE_TIME,
  });
}

export function useReportScan(
  scanId: string | null,
  options?: {
    refetchInterval?:
      | number
      | false
      | ((query: {
          state: { data?: Awaited<ReturnType<typeof fetchReportScan>> };
        }) => number | false);
  },
) {
  return useQuery({
    queryKey: reportKeys.scan(scanId ?? undefined),
    queryFn: ({ signal }) => fetchReportScan(scanId as string, signal),
    enabled: Boolean(scanId),
    staleTime: REPORT_SCAN_DETAIL_STALE_TIME,
    refetchInterval: options?.refetchInterval,
  });
}

export function useOpenPromisesReport(scanId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: reportKeys.document(scanId ?? undefined),
    queryFn: ({ signal }) => fetchOpenPromisesReport(scanId as string, signal),
    enabled: Boolean(scanId) && enabled,
    staleTime: REPORT_DOCUMENT_STALE_TIME,
  });
}
