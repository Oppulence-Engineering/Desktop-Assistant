"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchCorrectRelationship,
  type CorrectRelationshipInput,
} from "@/hooks/queries/utils/mutate-correct-relationship";
import { correctRelationshipKeys } from "@/hooks/queries/utils/correct-relationship-keys";
import { relationshipKeys } from "@/hooks/queries/utils/relationship-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Correct relationship. The transport stays in a non-client
 * module. Owned by `use-correct-relationship.lit.ts`.
 */
export function useCorrectRelationship() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { relationshipId: string; body: CorrectRelationshipInput }) =>
      fetchCorrectRelationship(input.relationshipId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: correctRelationshipKeys.all });
      void queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });
}
