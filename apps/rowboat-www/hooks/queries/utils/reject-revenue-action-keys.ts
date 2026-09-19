/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Reject revenue action.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-reject-revenue-action.lit.ts`.
 */
export const rejectRevenueActionKeys = {
  all: ["reject-revenue-action"] as const,
  list: (query?: Record<string, unknown>) =>
    [...rejectRevenueActionKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...rejectRevenueActionKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const REJECT_REVENUE_ACTION_STALE_TIME = 15_000;
