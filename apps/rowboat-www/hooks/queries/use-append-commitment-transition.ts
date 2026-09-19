"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchAppendCommitmentTransition,
  type AppendCommitmentTransitionInput,
} from "@/hooks/queries/utils/mutate-append-commitment-transition";
import { appendCommitmentTransitionKeys } from "@/hooks/queries/utils/append-commitment-transition-keys";
import { commitmentKeys } from "@/hooks/queries/utils/commitment-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Append commitment transition. The transport stays in a non-client
 * module. Owned by `use-append-commitment-transition.lit.ts`.
 */
export function useAppendCommitmentTransition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      relationshipId: string;
      commitmentId: string;
      body: AppendCommitmentTransitionInput;
    }) => fetchAppendCommitmentTransition(input.relationshipId, input.commitmentId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: appendCommitmentTransitionKeys.all });
      void queryClient.invalidateQueries({ queryKey: commitmentKeys.all });
    },
  });
}
