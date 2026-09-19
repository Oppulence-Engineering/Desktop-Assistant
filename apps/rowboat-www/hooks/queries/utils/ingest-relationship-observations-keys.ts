/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Ingest relationship observations.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-ingest-relationship-observations.lit.ts`.
 */
export const ingestRelationshipObservationsKeys = {
  all: ["ingest-relationship-observations"] as const,
  list: (query?: Record<string, unknown>) =>
    [...ingestRelationshipObservationsKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...ingestRelationshipObservationsKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const INGEST_RELATIONSHIP_OBSERVATIONS_STALE_TIME = 15_000;
