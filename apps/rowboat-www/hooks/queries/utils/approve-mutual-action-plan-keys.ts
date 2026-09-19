/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Approve mutual action plan.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-approve-mutual-action-plan.lit.ts`.
 */
export const approveMutualActionPlanKeys = {
  all: ["approve-mutual-action-plan"] as const,
  list: (query?: Record<string, unknown>) =>
    [...approveMutualActionPlanKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...approveMutualActionPlanKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const APPROVE_MUTUAL_ACTION_PLAN_STALE_TIME = 15_000;
