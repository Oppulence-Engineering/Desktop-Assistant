"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchRejectRelationshipRecommendation,
  type RejectRelationshipRecommendationInput,
} from "@/hooks/queries/utils/mutate-reject-relationship-recommendation";
import { rejectRelationshipRecommendationKeys } from "@/hooks/queries/utils/reject-relationship-recommendation-keys";
import { revenueActionKeys } from "@/hooks/queries/utils/revenue-action-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Reject relationship recommendation. The transport stays in a non-client
 * module. Owned by `use-reject-relationship-recommendation.lit.ts`.
 */
export function useRejectRelationshipRecommendation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { actionId: string; body: RejectRelationshipRecommendationInput }) =>
      fetchRejectRelationshipRecommendation(input.actionId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rejectRelationshipRecommendationKeys.all });
      void queryClient.invalidateQueries({ queryKey: revenueActionKeys.all });
    },
  });
}
