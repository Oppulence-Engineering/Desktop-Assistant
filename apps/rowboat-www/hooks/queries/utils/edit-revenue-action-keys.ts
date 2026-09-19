/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Edit revenue action.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-edit-revenue-action.lit.ts`.
 */
export const editRevenueActionKeys = {
  all: ["edit-revenue-action"] as const,
  list: (query?: Record<string, unknown>) =>
    [...editRevenueActionKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...editRevenueActionKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const EDIT_REVENUE_ACTION_STALE_TIME = 15_000;
