/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Approve relationship recommendation.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-approve-relationship-recommendation.lit.ts`.
 */
export const approveRelationshipRecommendationKeys = {
  all: ["approve-relationship-recommendation"] as const,
  list: (query?: Record<string, unknown>) =>
    [...approveRelationshipRecommendationKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...approveRelationshipRecommendationKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const APPROVE_RELATIONSHIP_RECOMMENDATION_STALE_TIME = 15_000;
