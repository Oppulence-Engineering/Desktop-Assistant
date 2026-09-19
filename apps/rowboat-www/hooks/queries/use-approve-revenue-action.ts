"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchApproveRevenueAction,
  type ApproveRevenueActionInput,
} from "@/hooks/queries/utils/mutate-approve-revenue-action";
import { approveRevenueActionKeys } from "@/hooks/queries/utils/approve-revenue-action-keys";
import { revenueActionKeys } from "@/hooks/queries/utils/revenue-action-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Approve revenue action. The transport stays in a non-client
 * module. Owned by `use-approve-revenue-action.lit.ts`.
 */
export function useApproveRevenueAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { actionId: string; body: ApproveRevenueActionInput }) =>
      fetchApproveRevenueAction(input.actionId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: approveRevenueActionKeys.all });
      void queryClient.invalidateQueries({ queryKey: revenueActionKeys.all });
    },
  });
}
