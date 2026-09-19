"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchIngestRelationshipObservations,
  type IngestRelationshipObservationsInput,
} from "@/hooks/queries/utils/mutate-ingest-relationship-observations";
import { ingestRelationshipObservationsKeys } from "@/hooks/queries/utils/ingest-relationship-observations-keys";
import { relationshipKeys } from "@/hooks/queries/utils/relationship-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Ingest relationship observations. The transport stays in a non-client
 * module. Owned by `use-ingest-relationship-observations.lit.ts`.
 */
export function useIngestRelationshipObservations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: IngestRelationshipObservationsInput) =>
      fetchIngestRelationshipObservations(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ingestRelationshipObservationsKeys.all });
      void queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });
}
