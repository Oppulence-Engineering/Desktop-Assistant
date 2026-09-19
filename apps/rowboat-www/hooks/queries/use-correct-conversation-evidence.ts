"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchCorrectConversationEvidence,
  type CorrectConversationEvidenceInput,
} from "@/hooks/queries/utils/mutate-correct-conversation-evidence";
import { correctConversationEvidenceKeys } from "@/hooks/queries/utils/correct-conversation-evidence-keys";
import { relationshipKeys } from "@/hooks/queries/utils/relationship-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Correct conversation evidence. The transport stays in a non-client
 * module. Owned by `use-correct-conversation-evidence.lit.ts`.
 */
export function useCorrectConversationEvidence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { relationshipId: string; body: CorrectConversationEvidenceInput }) =>
      fetchCorrectConversationEvidence(input.relationshipId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: correctConversationEvidenceKeys.all });
      void queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });
}
