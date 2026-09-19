"use client";

import "client-only";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  fetchLinkRevenueWorkspace,
  type LinkRevenueWorkspaceInput,
} from "@/hooks/queries/utils/mutate-link-revenue-workspace";
import { linkRevenueWorkspaceKeys } from "@/hooks/queries/utils/link-revenue-workspace-keys";
import { workspaceKeys } from "@/hooks/queries/utils/workspace-keys";
/**
 * @oppulence-gen kind=mutation
 * Client mutation hook for Link revenue workspace. The transport stays in a non-client
 * module. Owned by `use-link-revenue-workspace.lit.ts`.
 */
export function useLinkRevenueWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LinkRevenueWorkspaceInput) => fetchLinkRevenueWorkspace(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: linkRevenueWorkspaceKeys.all });
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
    },
  });
}
