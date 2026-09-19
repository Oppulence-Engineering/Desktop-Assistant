/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Start revenue leak scan.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-start-revenue-leak-scan.lit.ts`.
 */
export const startRevenueLeakScanKeys = {
  all: ["start-revenue-leak-scan"] as const,
  list: (query?: Record<string, unknown>) =>
    [...startRevenueLeakScanKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...startRevenueLeakScanKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const START_REVENUE_LEAK_SCAN_STALE_TIME = 15_000;
