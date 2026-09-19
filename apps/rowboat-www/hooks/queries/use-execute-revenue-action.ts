"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { fetchExecuteRevenueAction } from "@/hooks/queries/utils/mutate-execute-revenue-action";
import { executeRevenueActionKeys } from "@/hooks/queries/utils/execute-revenue-action-keys";
import { revenueActionKeys } from "@/hooks/queries/utils/revenue-action-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Execute revenue action. The transport stays in a non-client
 * module. Owned by `use-execute-revenue-action.lit.ts`.
 */
export function useExecuteRevenueAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { actionId: string }) => fetchExecuteRevenueAction(input.actionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: executeRevenueActionKeys.all });
      void queryClient.invalidateQueries({ queryKey: revenueActionKeys.all });
    },
  });
}
