/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Run commitment recovery.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-run-commitment-recovery.lit.ts`.
 */
export const runCommitmentRecoveryKeys = {
  all: ["run-commitment-recovery"] as const,
  list: (query?: Record<string, unknown>) =>
    [...runCommitmentRecoveryKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...runCommitmentRecoveryKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const RUN_COMMITMENT_RECOVERY_STALE_TIME = 15_000;
