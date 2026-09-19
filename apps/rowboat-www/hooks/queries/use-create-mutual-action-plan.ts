"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchCreateMutualActionPlan,
  type CreateMutualActionPlanInput,
} from "@/hooks/queries/utils/mutate-create-mutual-action-plan";
import { createMutualActionPlanKeys } from "@/hooks/queries/utils/create-mutual-action-plan-keys";
import { relationshipKeys } from "@/hooks/queries/utils/relationship-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Create mutual action plan. The transport stays in a non-client
 * module. Owned by `use-create-mutual-action-plan.lit.ts`.
 */
export function useCreateMutualActionPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { relationshipId: string; body: CreateMutualActionPlanInput }) =>
      fetchCreateMutualActionPlan(input.relationshipId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: createMutualActionPlanKeys.all });
      void queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });
}
