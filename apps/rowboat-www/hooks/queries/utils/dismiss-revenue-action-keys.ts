/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Dismiss revenue action.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-dismiss-revenue-action.lit.ts`.
 */
export const dismissRevenueActionKeys = {
  all: ["dismiss-revenue-action"] as const,
  list: (query?: Record<string, unknown>) =>
    [...dismissRevenueActionKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...dismissRevenueActionKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const DISMISS_REVENUE_ACTION_STALE_TIME = 15_000;
