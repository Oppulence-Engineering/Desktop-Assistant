/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Create relationship.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-create-relationship.lit.ts`.
 */
export const createRelationshipKeys = {
  all: ["create-relationship"] as const,
  list: (query?: Record<string, unknown>) =>
    [...createRelationshipKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...createRelationshipKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const CREATE_RELATIONSHIP_STALE_TIME = 15_000;
