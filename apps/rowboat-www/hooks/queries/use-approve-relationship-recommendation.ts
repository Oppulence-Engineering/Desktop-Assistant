"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchApproveRelationshipRecommendation,
  type ApproveRelationshipRecommendationInput,
} from "@/hooks/queries/utils/mutate-approve-relationship-recommendation";
import { approveRelationshipRecommendationKeys } from "@/hooks/queries/utils/approve-relationship-recommendation-keys";
import { revenueActionKeys } from "@/hooks/queries/utils/revenue-action-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Approve relationship recommendation. The transport stays in a non-client
 * module. Owned by `use-approve-relationship-recommendation.lit.ts`.
 */
export function useApproveRelationshipRecommendation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { actionId: string; body: ApproveRelationshipRecommendationInput }) =>
      fetchApproveRelationshipRecommendation(input.actionId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: approveRelationshipRecommendationKeys.all });
      void queryClient.invalidateQueries({ queryKey: revenueActionKeys.all });
    },
  });
}
