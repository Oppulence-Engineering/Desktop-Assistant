export const revenueScanKeys = {
  all: ["revenue-scan"] as const,
  detail: (id?: string) => [...revenueScanKeys.all, "detail", id ?? ""] as const,
};

export const REVENUE_SCAN_DETAIL_STALE_TIME = 15_000;
