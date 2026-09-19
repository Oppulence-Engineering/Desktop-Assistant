"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchSnoozeRevenueAction,
  type SnoozeRevenueActionInput,
} from "@/hooks/queries/utils/mutate-snooze-revenue-action";
import { snoozeRevenueActionKeys } from "@/hooks/queries/utils/snooze-revenue-action-keys";
import { revenueActionKeys } from "@/hooks/queries/utils/revenue-action-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Snooze revenue action. The transport stays in a non-client
 * module. Owned by `use-snooze-revenue-action.lit.ts`.
 */
export function useSnoozeRevenueAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { actionId: string; body: SnoozeRevenueActionInput }) =>
      fetchSnoozeRevenueAction(input.actionId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: snoozeRevenueActionKeys.all });
      void queryClient.invalidateQueries({ queryKey: revenueActionKeys.all });
    },
  });
}
