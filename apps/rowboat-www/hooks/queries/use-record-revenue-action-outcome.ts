"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchRecordRevenueActionOutcome,
  type RecordRevenueActionOutcomeInput,
} from "@/hooks/queries/utils/mutate-record-revenue-action-outcome";
import { recordRevenueActionOutcomeKeys } from "@/hooks/queries/utils/record-revenue-action-outcome-keys";
import { revenueActionKeys } from "@/hooks/queries/utils/revenue-action-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Record revenue action outcome. The transport stays in a non-client
 * module. Owned by `use-record-revenue-action-outcome.lit.ts`.
 */
export function useRecordRevenueActionOutcome() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { actionId: string; body: RecordRevenueActionOutcomeInput }) =>
      fetchRecordRevenueActionOutcome(input.actionId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recordRevenueActionOutcomeKeys.all });
      void queryClient.invalidateQueries({ queryKey: revenueActionKeys.all });
    },
  });
}
