/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Acknowledge mission control.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-acknowledge-mission-control.lit.ts`.
 */
export const acknowledgeMissionControlKeys = {
  all: ["acknowledge-mission-control"] as const,
  list: (query?: Record<string, unknown>) =>
    [...acknowledgeMissionControlKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...acknowledgeMissionControlKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const ACKNOWLEDGE_MISSION_CONTROL_STALE_TIME = 15_000;
