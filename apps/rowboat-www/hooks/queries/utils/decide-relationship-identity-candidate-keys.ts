/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Decide relationship identity candidate.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-decide-relationship-identity-candidate.lit.ts`.
 */
export const decideRelationshipIdentityCandidateKeys = {
  all: ["decide-relationship-identity-candidate"] as const,
  list: (query?: Record<string, unknown>) =>
    [...decideRelationshipIdentityCandidateKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...decideRelationshipIdentityCandidateKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const DECIDE_RELATIONSHIP_IDENTITY_CANDIDATE_STALE_TIME = 15_000;
