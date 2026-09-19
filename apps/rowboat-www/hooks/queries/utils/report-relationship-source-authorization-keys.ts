/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Report relationship source authorization.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-report-relationship-source-authorization.lit.ts`.
 */
export const reportRelationshipSourceAuthorizationKeys = {
  all: ["report-relationship-source-authorization"] as const,
  list: (query?: Record<string, unknown>) =>
    [...reportRelationshipSourceAuthorizationKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...reportRelationshipSourceAuthorizationKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const REPORT_RELATIONSHIP_SOURCE_AUTHORIZATION_STALE_TIME = 15_000;
