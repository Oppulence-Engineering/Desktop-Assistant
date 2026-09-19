"use client";

import "client-only";

import { useQuery } from "@tanstack/react-query";

import { fetchWorkspaceNotes } from "@/hooks/queries/utils/fetch-workspace-notes";
import { fetchWorkspace } from "@/hooks/queries/utils/fetch-workspace";
import { WORKSPACE_CURRENT_STALE_TIME, workspaceKeys } from "@/hooks/queries/utils/workspace-keys";

export function useWorkspace() {
  return useQuery({
    queryKey: workspaceKeys.current(),
    queryFn: ({ signal }) => fetchWorkspace(signal),
    staleTime: WORKSPACE_CURRENT_STALE_TIME,
  });
}

export function useWorkspaceNotes() {
  return useQuery({
    queryKey: workspaceKeys.notes(),
    queryFn: ({ signal }) => fetchWorkspaceNotes(signal),
    staleTime: WORKSPACE_CURRENT_STALE_TIME,
  });
}
