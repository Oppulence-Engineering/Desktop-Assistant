/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Append commitment transition.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-append-commitment-transition.lit.ts`.
 */
export const appendCommitmentTransitionKeys = {
  all: ["append-commitment-transition"] as const,
  list: (query?: Record<string, unknown>) =>
    [...appendCommitmentTransitionKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...appendCommitmentTransitionKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const APPEND_COMMITMENT_TRANSITION_STALE_TIME = 15_000;
