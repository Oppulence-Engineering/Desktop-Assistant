/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Create mutual action plan.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-create-mutual-action-plan.lit.ts`.
 */
export const createMutualActionPlanKeys = {
  all: ["create-mutual-action-plan"] as const,
  list: (query?: Record<string, unknown>) =>
    [...createMutualActionPlanKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...createMutualActionPlanKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const CREATE_MUTUAL_ACTION_PLAN_STALE_TIME = 15_000;
