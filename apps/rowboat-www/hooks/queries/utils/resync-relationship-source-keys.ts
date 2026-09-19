/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Resync relationship source.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-resync-relationship-source.lit.ts`.
 */
export const resyncRelationshipSourceKeys = {
  all: ["resync-relationship-source"] as const,
  list: (query?: Record<string, unknown>) =>
    [...resyncRelationshipSourceKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...resyncRelationshipSourceKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const RESYNC_RELATIONSHIP_SOURCE_STALE_TIME = 15_000;
