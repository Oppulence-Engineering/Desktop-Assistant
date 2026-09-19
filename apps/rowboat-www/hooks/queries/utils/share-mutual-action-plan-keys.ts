/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Share mutual action plan.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-share-mutual-action-plan.lit.ts`.
 */
export const shareMutualActionPlanKeys = {
  all: ["share-mutual-action-plan"] as const,
  list: (query?: Record<string, unknown>) =>
    [...shareMutualActionPlanKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...shareMutualActionPlanKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const SHARE_MUTUAL_ACTION_PLAN_STALE_TIME = 15_000;
