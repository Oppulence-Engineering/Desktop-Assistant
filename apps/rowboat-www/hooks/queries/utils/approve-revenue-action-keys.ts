/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Approve revenue action.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-approve-revenue-action.lit.ts`.
 */
export const approveRevenueActionKeys = {
  all: ["approve-revenue-action"] as const,
  list: (query?: Record<string, unknown>) =>
    [...approveRevenueActionKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...approveRevenueActionKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const APPROVE_REVENUE_ACTION_STALE_TIME = 15_000;
