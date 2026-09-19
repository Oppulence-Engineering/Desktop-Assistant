/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Record revenue action outcome.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-record-revenue-action-outcome.lit.ts`.
 */
export const recordRevenueActionOutcomeKeys = {
  all: ["record-revenue-action-outcome"] as const,
  list: (query?: Record<string, unknown>) =>
    [...recordRevenueActionOutcomeKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...recordRevenueActionOutcomeKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const RECORD_REVENUE_ACTION_OUTCOME_STALE_TIME = 15_000;
