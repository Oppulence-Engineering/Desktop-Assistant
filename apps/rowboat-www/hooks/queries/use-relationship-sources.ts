"use client";

import "client-only";

import { useQuery } from "@tanstack/react-query";

import {
  fetchRelationshipSources,
  fetchRelationshipSourceStatuses,
} from "@/hooks/queries/utils/fetch-relationship-sources";
import {
  RELATIONSHIP_SOURCE_LIST_STALE_TIME,
  relationshipSourceKeys,
} from "@/hooks/queries/utils/relationship-source-keys";

export function useRelationshipSourceStatuses(options?: {
  refetchInterval?:
    | number
    | false
    | ((query: {
        state: { data?: Awaited<ReturnType<typeof fetchRelationshipSourceStatuses>> };
      }) => number | false);
}) {
  return useQuery({
    queryKey: relationshipSourceKeys.list(),
    queryFn: ({ signal }) => fetchRelationshipSourceStatuses(signal),
    staleTime: RELATIONSHIP_SOURCE_LIST_STALE_TIME,
    refetchInterval: options?.refetchInterval,
  });
}

export function useRelationshipSourceInventory() {
  return useQuery({
    queryKey: relationshipSourceKeys.inventory(),
    queryFn: ({ signal }) => fetchRelationshipSources(signal),
    staleTime: RELATIONSHIP_SOURCE_LIST_STALE_TIME,
  });
}
