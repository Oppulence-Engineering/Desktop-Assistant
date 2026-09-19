"use client";

import "client-only";

import { useQuery } from "@tanstack/react-query";

import {
  fetchComposioConnections,
  fetchComposioToolkits,
} from "@/hooks/queries/utils/fetch-composio";
import { COMPOSIO_LIST_STALE_TIME, composioKeys } from "@/hooks/queries/utils/composio-keys";

export function useComposioToolkits() {
  return useQuery({
    queryKey: composioKeys.toolkits(),
    queryFn: ({ signal }) => fetchComposioToolkits(signal),
    staleTime: COMPOSIO_LIST_STALE_TIME,
  });
}

export function useComposioConnections() {
  return useQuery({
    queryKey: composioKeys.connections(),
    queryFn: ({ signal }) => fetchComposioConnections(signal),
    staleTime: COMPOSIO_LIST_STALE_TIME,
  });
}
