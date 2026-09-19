"use client";

import "client-only";

import { useQuery } from "@tanstack/react-query";

import { fetchRevenueActions } from "@/hooks/queries/utils/fetch-revenue-actions";
import {
  REVENUE_ACTION_LIST_STALE_TIME,
  revenueActionKeys,
} from "@/hooks/queries/utils/revenue-action-keys";

export function useRevenueActions(filter: string, limit = 50) {
  return useQuery({
    queryKey: revenueActionKeys.list(filter, limit),
    queryFn: ({ signal }) => fetchRevenueActions(filter, limit, signal),
    staleTime: REVENUE_ACTION_LIST_STALE_TIME,
  });
}
