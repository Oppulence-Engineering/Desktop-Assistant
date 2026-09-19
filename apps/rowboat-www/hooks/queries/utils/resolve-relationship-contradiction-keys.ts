/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Resolve relationship contradiction.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-resolve-relationship-contradiction.lit.ts`.
 */
export const resolveRelationshipContradictionKeys = {
  all: ["resolve-relationship-contradiction"] as const,
  list: (query?: Record<string, unknown>) =>
    [...resolveRelationshipContradictionKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...resolveRelationshipContradictionKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const RESOLVE_RELATIONSHIP_CONTRADICTION_STALE_TIME = 15_000;
