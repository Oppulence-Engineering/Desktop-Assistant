"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchRetractRelationshipAssertion,
  type RetractRelationshipAssertionInput,
} from "@/hooks/queries/utils/mutate-retract-relationship-assertion";
import { retractRelationshipAssertionKeys } from "@/hooks/queries/utils/retract-relationship-assertion-keys";
import { relationshipKeys } from "@/hooks/queries/utils/relationship-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Retract relationship assertion. The transport stays in a non-client
 * module. Owned by `use-retract-relationship-assertion.lit.ts`.
 */
export function useRetractRelationshipAssertion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      relationshipId: string;
      assertionId: string;
      body: RetractRelationshipAssertionInput;
    }) => fetchRetractRelationshipAssertion(input.relationshipId, input.assertionId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: retractRelationshipAssertionKeys.all });
      void queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });
}
