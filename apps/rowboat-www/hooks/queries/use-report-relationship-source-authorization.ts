"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchReportRelationshipSourceAuthorization,
  type ReportRelationshipSourceAuthorizationInput,
} from "@/hooks/queries/utils/mutate-report-relationship-source-authorization";
import { reportRelationshipSourceAuthorizationKeys } from "@/hooks/queries/utils/report-relationship-source-authorization-keys";
import { relationshipSourceKeys } from "@/hooks/queries/utils/relationship-source-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Report relationship source authorization. The transport stays in a non-client
 * module. Owned by `use-report-relationship-source-authorization.lit.ts`.
 */
export function useReportRelationshipSourceAuthorization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { source: string; body: ReportRelationshipSourceAuthorizationInput }) =>
      fetchReportRelationshipSourceAuthorization(input.source, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: reportRelationshipSourceAuthorizationKeys.all,
      });
      void queryClient.invalidateQueries({ queryKey: relationshipSourceKeys.all });
    },
  });
}
