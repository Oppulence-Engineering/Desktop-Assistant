"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchRejectRevenueAction,
  type RejectRevenueActionInput,
} from "@/hooks/queries/utils/mutate-reject-revenue-action";
import { rejectRevenueActionKeys } from "@/hooks/queries/utils/reject-revenue-action-keys";
import { revenueActionKeys } from "@/hooks/queries/utils/revenue-action-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Reject revenue action. The transport stays in a non-client
 * module. Owned by `use-reject-revenue-action.lit.ts`.
 */
export function useRejectRevenueAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { actionId: string; body: RejectRevenueActionInput }) =>
      fetchRejectRevenueAction(input.actionId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rejectRevenueActionKeys.all });
      void queryClient.invalidateQueries({ queryKey: revenueActionKeys.all });
    },
  });
}
