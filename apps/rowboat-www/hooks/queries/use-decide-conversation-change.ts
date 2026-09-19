"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchDecideConversationChange,
  type DecideConversationChangeInput,
} from "@/hooks/queries/utils/mutate-decide-conversation-change";
import { decideConversationChangeKeys } from "@/hooks/queries/utils/decide-conversation-change-keys";
import { relationshipKeys } from "@/hooks/queries/utils/relationship-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Decide conversation change. The transport stays in a non-client
 * module. Owned by `use-decide-conversation-change.lit.ts`.
 */
export function useDecideConversationChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { relationshipId: string; body: DecideConversationChangeInput }) =>
      fetchDecideConversationChange(input.relationshipId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: decideConversationChangeKeys.all });
      void queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });
}
