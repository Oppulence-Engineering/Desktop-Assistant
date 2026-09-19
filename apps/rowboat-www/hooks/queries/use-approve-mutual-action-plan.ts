"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchApproveMutualActionPlan,
  type ApproveMutualActionPlanInput,
} from "@/hooks/queries/utils/mutate-approve-mutual-action-plan";
import { approveMutualActionPlanKeys } from "@/hooks/queries/utils/approve-mutual-action-plan-keys";
import { relationshipKeys } from "@/hooks/queries/utils/relationship-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Approve mutual action plan. The transport stays in a non-client
 * module. Owned by `use-approve-mutual-action-plan.lit.ts`.
 */
export function useApproveMutualActionPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      relationshipId: string;
      planId: string;
      body: ApproveMutualActionPlanInput;
    }) => fetchApproveMutualActionPlan(input.relationshipId, input.planId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: approveMutualActionPlanKeys.all });
      void queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });
}
