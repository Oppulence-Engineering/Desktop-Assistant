"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchRunCommitmentRecovery,
  type RunCommitmentRecoveryInput,
} from "@/hooks/queries/utils/mutate-run-commitment-recovery";
import { runCommitmentRecoveryKeys } from "@/hooks/queries/utils/run-commitment-recovery-keys";
import { relationshipKeys } from "@/hooks/queries/utils/relationship-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Run commitment recovery. The transport stays in a non-client
 * module. Owned by `use-run-commitment-recovery.lit.ts`.
 */
export function useRunCommitmentRecovery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { relationshipId: string; body: RunCommitmentRecoveryInput }) =>
      fetchRunCommitmentRecovery(input.relationshipId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: runCommitmentRecoveryKeys.all });
      void queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });
}
