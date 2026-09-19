"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchDecideRelationshipAttention,
  type DecideRelationshipAttentionInput,
} from "@/hooks/queries/utils/mutate-decide-relationship-attention";
import { decideRelationshipAttentionKeys } from "@/hooks/queries/utils/decide-relationship-attention-keys";
import { relationshipKeys } from "@/hooks/queries/utils/relationship-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Decide relationship attention. The transport stays in a non-client
 * module. Owned by `use-decide-relationship-attention.lit.ts`.
 */
export function useDecideRelationshipAttention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { attentionId: string; body: DecideRelationshipAttentionInput }) =>
      fetchDecideRelationshipAttention(input.attentionId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: decideRelationshipAttentionKeys.all });
      void queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });
}
