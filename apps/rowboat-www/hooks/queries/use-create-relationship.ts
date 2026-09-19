"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchCreateRelationship,
  type CreateRelationshipInput,
} from "@/hooks/queries/utils/mutate-create-relationship";
import { createRelationshipKeys } from "@/hooks/queries/utils/create-relationship-keys";
import { relationshipKeys } from "@/hooks/queries/utils/relationship-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Create relationship. The transport stays in a non-client
 * module. Owned by `use-create-relationship.lit.ts`.
 */
export function useCreateRelationship() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRelationshipInput) => fetchCreateRelationship(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: createRelationshipKeys.all });
      void queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });
}
