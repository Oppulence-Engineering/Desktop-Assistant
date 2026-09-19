/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Retract relationship assertion.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-retract-relationship-assertion.lit.ts`.
 */
export const retractRelationshipAssertionKeys = {
  all: ["retract-relationship-assertion"] as const,
  list: (query?: Record<string, unknown>) =>
    [...retractRelationshipAssertionKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...retractRelationshipAssertionKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const RETRACT_RELATIONSHIP_ASSERTION_STALE_TIME = 15_000;
