"use client";

import "client-only";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import {
  fetchRelationshipRefreshBlocker,
  fetchWorkflowRuns,
  fetchWorkflowTasks,
  fetchWorkflowTemplates,
  type WorkflowRunFilters,
} from "@/hooks/queries/utils/fetch-workflows";
import { WORKFLOW_LIST_STALE_TIME, workflowKeys } from "@/hooks/queries/utils/workflow-keys";

export function useWorkflowTasks() {
  return useQuery({
    queryKey: workflowKeys.tasks(),
    queryFn: ({ signal }) => fetchWorkflowTasks(signal),
    staleTime: WORKFLOW_LIST_STALE_TIME,
  });
}

export function useWorkflowTemplates() {
  return useQuery({
    queryKey: workflowKeys.templates(),
    queryFn: ({ signal }) => fetchWorkflowTemplates(signal),
    staleTime: WORKFLOW_LIST_STALE_TIME,
  });
}

export function useWorkflowRuns(filters: WorkflowRunFilters) {
  return useInfiniteQuery({
    queryKey: workflowKeys.runs({
      status: filters.status ?? "all",
      trigger: filters.trigger ?? "all",
      executor: filters.executor ?? "all",
    }),
    queryFn: ({ pageParam, signal }) =>
      fetchWorkflowRuns({ ...filters, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: WORKFLOW_LIST_STALE_TIME,
  });
}

export function useRelationshipRefreshBlocker() {
  return useQuery({
    queryKey: workflowKeys.latest("oppulence-relationship-refresh"),
    queryFn: ({ signal }) => fetchRelationshipRefreshBlocker(signal),
    staleTime: WORKFLOW_LIST_STALE_TIME,
  });
}
