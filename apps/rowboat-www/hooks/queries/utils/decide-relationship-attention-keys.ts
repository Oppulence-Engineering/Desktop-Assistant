/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Decide relationship attention.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-decide-relationship-attention.lit.ts`.
 */
export const decideRelationshipAttentionKeys = {
  all: ["decide-relationship-attention"] as const,
  list: (query?: Record<string, unknown>) =>
    [...decideRelationshipAttentionKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...decideRelationshipAttentionKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const DECIDE_RELATIONSHIP_ATTENTION_STALE_TIME = 15_000;
