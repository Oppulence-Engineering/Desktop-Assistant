"use client";

import "client-only";

import { useQuery } from "@tanstack/react-query";

import { fetchDigest, fetchImpact } from "@/hooks/queries/utils/fetch-impact";
import { IMPACT_BUNDLE_STALE_TIME, impactKeys } from "@/hooks/queries/utils/impact-keys";

export function useImpactBundle() {
  return useQuery({
    queryKey: impactKeys.bundle(),
    queryFn: async ({ signal }) => {
      const [data, digest] = await Promise.all([
        fetchImpact(signal),
        fetchDigest(signal).catch(() => null),
      ]);
      return { data, digest };
    },
    staleTime: IMPACT_BUNDLE_STALE_TIME,
  });
}

export function useImpact() {
  return useQuery({
    queryKey: impactKeys.all,
    queryFn: ({ signal }) => fetchImpact(signal),
    staleTime: IMPACT_BUNDLE_STALE_TIME,
  });
}
