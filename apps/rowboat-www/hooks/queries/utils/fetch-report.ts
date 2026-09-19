import {
  GetOpenPromisesReport200Response,
  GetRevenueLeakScan200Response,
  ListRevenueLeakScans200Response,
} from "@/lib/api/generated/zod/revenue/revenue";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";
import type { OpenPromisesReport, RevenueLeakScan } from "@/types/revenue";

const REPORT_SCAN_LIST_PATH = "/revenue-leak-scans?limit=10";

function reportScanPath(scanId: string): string {
  return `/revenue-leak-scans/${encodeURIComponent(scanId)}`;
}

function reportDocumentPath(scanId: string): string {
  return `/revenue-leak-scans/${encodeURIComponent(scanId)}/report`;
}

export async function loadReportScans(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<RevenueLeakScan[]> {
  const body = await request({
    path: REPORT_SCAN_LIST_PATH,
    schema: ListRevenueLeakScans200Response,
    signal,
  });
  return body.scans as RevenueLeakScan[];
}

export async function loadReportScan(
  request: RequestJsonFn,
  scanId: string,
  signal?: AbortSignal,
): Promise<RevenueLeakScan> {
  return (await request({
    path: reportScanPath(scanId),
    schema: GetRevenueLeakScan200Response,
    signal,
  })) as RevenueLeakScan;
}

export async function loadOpenPromisesReport(
  request: RequestJsonFn,
  scanId: string,
  signal?: AbortSignal,
): Promise<OpenPromisesReport> {
  const report = await request({
    path: reportDocumentPath(scanId),
    schema: GetOpenPromisesReport200Response,
    signal,
  });
  return {
    ...report,
    items: report.items.map((item) => ({ ...item, dueAt: item.dueAt ?? undefined })),
  } as OpenPromisesReport;
}

export function fetchReportScans(signal?: AbortSignal): Promise<RevenueLeakScan[]> {
  return loadReportScans(requestJson, signal);
}

export function fetchReportScan(scanId: string, signal?: AbortSignal): Promise<RevenueLeakScan> {
  return loadReportScan(requestJson, scanId, signal);
}

export function fetchOpenPromisesReport(
  scanId: string,
  signal?: AbortSignal,
): Promise<OpenPromisesReport> {
  return loadOpenPromisesReport(requestJson, scanId, signal);
}
