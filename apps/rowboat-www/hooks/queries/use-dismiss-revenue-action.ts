"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchDismissRevenueAction,
  type DismissRevenueActionInput,
} from "@/hooks/queries/utils/mutate-dismiss-revenue-action";
import { dismissRevenueActionKeys } from "@/hooks/queries/utils/dismiss-revenue-action-keys";
import { revenueActionKeys } from "@/hooks/queries/utils/revenue-action-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Dismiss revenue action. The transport stays in a non-client
 * module. Owned by `use-dismiss-revenue-action.lit.ts`.
 */
export function useDismissRevenueAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { actionId: string; body: DismissRevenueActionInput }) =>
      fetchDismissRevenueAction(input.actionId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dismissRevenueActionKeys.all });
      void queryClient.invalidateQueries({ queryKey: revenueActionKeys.all });
    },
  });
}
