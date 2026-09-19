/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Disconnect relationship source.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-disconnect-relationship-source.lit.ts`.
 */
export const disconnectRelationshipSourceKeys = {
  all: ["disconnect-relationship-source"] as const,
  list: (query?: Record<string, unknown>) =>
    [...disconnectRelationshipSourceKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...disconnectRelationshipSourceKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const DISCONNECT_RELATIONSHIP_SOURCE_STALE_TIME = 15_000;
