/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Evaluate revenue action.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-evaluate-revenue-action.lit.ts`.
 */
export const evaluateRevenueActionKeys = {
  all: ["evaluate-revenue-action"] as const,
  list: (query?: Record<string, unknown>) =>
    [...evaluateRevenueActionKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...evaluateRevenueActionKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const EVALUATE_REVENUE_ACTION_STALE_TIME = 15_000;
