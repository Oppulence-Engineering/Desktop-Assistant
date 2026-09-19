/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Create revenue action.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-create-revenue-action.lit.ts`.
 */
export const createRevenueActionKeys = {
  all: ["create-revenue-action"] as const,
  list: (query?: Record<string, unknown>) =>
    [...createRevenueActionKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...createRevenueActionKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const CREATE_REVENUE_ACTION_STALE_TIME = 15_000;
