"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchRequestConversationDeletion,
  type RequestConversationDeletionInput,
} from "@/hooks/queries/utils/mutate-request-conversation-deletion";
import { requestConversationDeletionKeys } from "@/hooks/queries/utils/request-conversation-deletion-keys";
import { relationshipKeys } from "@/hooks/queries/utils/relationship-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Request conversation deletion. The transport stays in a non-client
 * module. Owned by `use-request-conversation-deletion.lit.ts`.
 */
export function useRequestConversationDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { relationshipId: string; body: RequestConversationDeletionInput }) =>
      fetchRequestConversationDeletion(input.relationshipId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: requestConversationDeletionKeys.all });
      void queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });
}
