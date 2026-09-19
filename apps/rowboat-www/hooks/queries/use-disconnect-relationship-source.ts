"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { fetchDisconnectRelationshipSource } from "@/hooks/queries/utils/mutate-disconnect-relationship-source";
import { disconnectRelationshipSourceKeys } from "@/hooks/queries/utils/disconnect-relationship-source-keys";
import { relationshipSourceKeys } from "@/hooks/queries/utils/relationship-source-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Disconnect relationship source. The transport stays in a non-client
 * module. Owned by `use-disconnect-relationship-source.lit.ts`.
 */
export function useDisconnectRelationshipSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { source: string; sourceAccountId: string }) =>
      fetchDisconnectRelationshipSource(input.source, input.sourceAccountId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: disconnectRelationshipSourceKeys.all });
      void queryClient.invalidateQueries({ queryKey: relationshipSourceKeys.all });
    },
  });
}
