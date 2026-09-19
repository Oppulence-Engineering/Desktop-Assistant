/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Execute revenue action.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-execute-revenue-action.lit.ts`.
 */
export const executeRevenueActionKeys = {
  all: ["execute-revenue-action"] as const,
  list: (query?: Record<string, unknown>) =>
    [...executeRevenueActionKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...executeRevenueActionKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const EXECUTE_REVENUE_ACTION_STALE_TIME = 15_000;
