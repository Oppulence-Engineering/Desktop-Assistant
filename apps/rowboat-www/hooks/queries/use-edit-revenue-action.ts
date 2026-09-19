"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchEditRevenueAction,
  type EditRevenueActionInput,
} from "@/hooks/queries/utils/mutate-edit-revenue-action";
import { editRevenueActionKeys } from "@/hooks/queries/utils/edit-revenue-action-keys";
import { revenueActionKeys } from "@/hooks/queries/utils/revenue-action-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Edit revenue action. The transport stays in a non-client
 * module. Owned by `use-edit-revenue-action.lit.ts`.
 */
export function useEditRevenueAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { actionId: string; body: EditRevenueActionInput }) =>
      fetchEditRevenueAction(input.actionId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: editRevenueActionKeys.all });
      void queryClient.invalidateQueries({ queryKey: revenueActionKeys.all });
    },
  });
}
