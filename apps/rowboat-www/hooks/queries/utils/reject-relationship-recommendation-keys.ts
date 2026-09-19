/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Reject relationship recommendation.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-reject-relationship-recommendation.lit.ts`.
 */
export const rejectRelationshipRecommendationKeys = {
  all: ["reject-relationship-recommendation"] as const,
  list: (query?: Record<string, unknown>) =>
    [...rejectRelationshipRecommendationKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...rejectRelationshipRecommendationKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const REJECT_RELATIONSHIP_RECOMMENDATION_STALE_TIME = 15_000;
