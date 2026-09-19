"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchResolveRelationshipContradiction,
  type ResolveRelationshipContradictionInput,
} from "@/hooks/queries/utils/mutate-resolve-relationship-contradiction";
import { resolveRelationshipContradictionKeys } from "@/hooks/queries/utils/resolve-relationship-contradiction-keys";
import { relationshipKeys } from "@/hooks/queries/utils/relationship-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Resolve relationship contradiction. The transport stays in a non-client
 * module. Owned by `use-resolve-relationship-contradiction.lit.ts`.
 */
export function useResolveRelationshipContradiction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      relationshipId: string;
      caseId: string;
      body: ResolveRelationshipContradictionInput;
    }) => fetchResolveRelationshipContradiction(input.relationshipId, input.caseId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resolveRelationshipContradictionKeys.all });
      void queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });
}
