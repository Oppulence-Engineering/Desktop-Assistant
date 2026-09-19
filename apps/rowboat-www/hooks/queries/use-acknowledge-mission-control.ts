"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchAcknowledgeMissionControl,
  type AcknowledgeMissionControlInput,
} from "@/hooks/queries/utils/mutate-acknowledge-mission-control";
import { acknowledgeMissionControlKeys } from "@/hooks/queries/utils/acknowledge-mission-control-keys";
import { relationshipKeys } from "@/hooks/queries/utils/relationship-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Acknowledge mission control. The transport stays in a non-client
 * module. Owned by `use-acknowledge-mission-control.lit.ts`.
 */
export function useAcknowledgeMissionControl() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { relationshipId: string; body: AcknowledgeMissionControlInput }) =>
      fetchAcknowledgeMissionControl(input.relationshipId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: acknowledgeMissionControlKeys.all });
      void queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });
}
