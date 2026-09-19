"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { fetchEvaluateRevenueAction } from "@/hooks/queries/utils/mutate-evaluate-revenue-action";
import { evaluateRevenueActionKeys } from "@/hooks/queries/utils/evaluate-revenue-action-keys";
import { revenueActionKeys } from "@/hooks/queries/utils/revenue-action-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Evaluate revenue action. The transport stays in a non-client
 * module. Owned by `use-evaluate-revenue-action.lit.ts`.
 */
export function useEvaluateRevenueAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { actionId: string }) => fetchEvaluateRevenueAction(input.actionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: evaluateRevenueActionKeys.all });
      void queryClient.invalidateQueries({ queryKey: revenueActionKeys.all });
    },
  });
}
