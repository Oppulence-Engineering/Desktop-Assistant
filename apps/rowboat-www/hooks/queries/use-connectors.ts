"use client";

import "client-only";

import { useQuery } from "@tanstack/react-query";

import { fetchConnectors } from "@/hooks/queries/utils/fetch-connectors";
import { CONNECTOR_LIST_STALE_TIME, connectorKeys } from "@/hooks/queries/utils/connector-keys";

export function useConnectors() {
  return useQuery({
    queryKey: connectorKeys.list(),
    queryFn: ({ signal }) => fetchConnectors(signal),
    staleTime: CONNECTOR_LIST_STALE_TIME,
  });
}
