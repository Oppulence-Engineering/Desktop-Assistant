"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchCreateRevenueAction,
  type CreateRevenueActionInput,
} from "@/hooks/queries/utils/mutate-create-revenue-action";
import { createRevenueActionKeys } from "@/hooks/queries/utils/create-revenue-action-keys";
import { revenueActionKeys } from "@/hooks/queries/utils/revenue-action-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Create revenue action. The transport stays in a non-client
 * module. Owned by `use-create-revenue-action.lit.ts`.
 */
export function useCreateRevenueAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRevenueActionInput) => fetchCreateRevenueAction(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: createRevenueActionKeys.all });
      void queryClient.invalidateQueries({ queryKey: revenueActionKeys.all });
    },
  });
}
