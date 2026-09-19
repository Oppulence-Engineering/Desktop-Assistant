"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchDecideRelationshipIdentityCandidate,
  type DecideRelationshipIdentityCandidateInput,
} from "@/hooks/queries/utils/mutate-decide-relationship-identity-candidate";
import { decideRelationshipIdentityCandidateKeys } from "@/hooks/queries/utils/decide-relationship-identity-candidate-keys";
import { relationshipKeys } from "@/hooks/queries/utils/relationship-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Decide relationship identity candidate. The transport stays in a non-client
 * module. Owned by `use-decide-relationship-identity-candidate.lit.ts`.
 */
export function useDecideRelationshipIdentityCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { candidateId: string; body: DecideRelationshipIdentityCandidateInput }) =>
      fetchDecideRelationshipIdentityCandidate(input.candidateId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: decideRelationshipIdentityCandidateKeys.all });
      void queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });
}
