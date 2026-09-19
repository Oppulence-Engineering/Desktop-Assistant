"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchResyncRelationshipSource,
  type ResyncRelationshipSourceInput,
} from "@/hooks/queries/utils/mutate-resync-relationship-source";
import { resyncRelationshipSourceKeys } from "@/hooks/queries/utils/resync-relationship-source-keys";
import { relationshipSourceKeys } from "@/hooks/queries/utils/relationship-source-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Resync relationship source. The transport stays in a non-client
 * module. Owned by `use-resync-relationship-source.lit.ts`.
 */
export function useResyncRelationshipSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { source: string; body: ResyncRelationshipSourceInput }) =>
      fetchResyncRelationshipSource(input.source, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resyncRelationshipSourceKeys.all });
      void queryClient.invalidateQueries({ queryKey: relationshipSourceKeys.all });
    },
  });
}
