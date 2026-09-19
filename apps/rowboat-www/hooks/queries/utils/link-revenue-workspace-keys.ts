/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Link revenue workspace.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-link-revenue-workspace.lit.ts`.
 */
export const linkRevenueWorkspaceKeys = {
  all: ["link-revenue-workspace"] as const,
  list: (query?: Record<string, unknown>) =>
    [...linkRevenueWorkspaceKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...linkRevenueWorkspaceKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const LINK_REVENUE_WORKSPACE_STALE_TIME = 15_000;
