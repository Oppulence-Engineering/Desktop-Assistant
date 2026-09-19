/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Correct relationship.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-correct-relationship.lit.ts`.
 */
export const correctRelationshipKeys = {
  all: ["correct-relationship"] as const,
  list: (query?: Record<string, unknown>) =>
    [...correctRelationshipKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...correctRelationshipKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const CORRECT_RELATIONSHIP_STALE_TIME = 15_000;
