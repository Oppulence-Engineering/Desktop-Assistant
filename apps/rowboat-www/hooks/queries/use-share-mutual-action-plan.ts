"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchShareMutualActionPlan,
  type ShareMutualActionPlanInput,
} from "@/hooks/queries/utils/mutate-share-mutual-action-plan";
import { shareMutualActionPlanKeys } from "@/hooks/queries/utils/share-mutual-action-plan-keys";
import { relationshipKeys } from "@/hooks/queries/utils/relationship-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Share mutual action plan. The transport stays in a non-client
 * module. Owned by `use-share-mutual-action-plan.lit.ts`.
 */
export function useShareMutualActionPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      relationshipId: string;
      planId: string;
      body: ShareMutualActionPlanInput;
    }) => fetchShareMutualActionPlan(input.relationshipId, input.planId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shareMutualActionPlanKeys.all });
      void queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });
}
