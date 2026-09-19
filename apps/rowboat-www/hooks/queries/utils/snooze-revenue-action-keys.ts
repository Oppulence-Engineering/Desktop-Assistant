/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Snooze revenue action.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-snooze-revenue-action.lit.ts`.
 */
export const snoozeRevenueActionKeys = {
  all: ["snooze-revenue-action"] as const,
  list: (query?: Record<string, unknown>) =>
    [...snoozeRevenueActionKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...snoozeRevenueActionKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const SNOOZE_REVENUE_ACTION_STALE_TIME = 15_000;
