export const reportKeys = {
  all: ["report"] as const,
  scans: () => [...reportKeys.all, "scans"] as const,
  scanList: () => [...reportKeys.scans(), "list"] as const,
  scan: (id?: string) => [...reportKeys.scans(), "detail", id ?? ""] as const,
  document: (id?: string) => [...reportKeys.all, "document", id ?? ""] as const,
};

export const REPORT_SCAN_LIST_STALE_TIME = 15_000;
export const REPORT_SCAN_DETAIL_STALE_TIME = 15_000;
export const REPORT_DOCUMENT_STALE_TIME = 15_000;
