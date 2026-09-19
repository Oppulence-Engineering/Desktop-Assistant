"use client";

import "client-only";

import { useQuery } from "@tanstack/react-query";

import {
  fetchConsolePreferences,
  fetchConsoleResources,
} from "@/hooks/queries/utils/fetch-console";
import {
  CONSOLE_PREFERENCES_STALE_TIME,
  CONSOLE_RESOURCE_STALE_TIME,
  consoleKeys,
} from "@/hooks/queries/utils/console-keys";
import type { ConsoleResourceKind } from "@/lib/console-contract";

export function useConsolePreferences() {
  return useQuery({
    queryKey: consoleKeys.preferences(),
    queryFn: ({ signal }) => fetchConsolePreferences(signal),
    staleTime: CONSOLE_PREFERENCES_STALE_TIME,
  });
}

export function useConsoleResources<T>(
  kind: ConsoleResourceKind,
  select?: (resources: Awaited<ReturnType<typeof fetchConsoleResources>>) => T,
) {
  return useQuery({
    queryKey: consoleKeys.resourceKind(kind),
    queryFn: ({ signal }) => fetchConsoleResources(kind, signal),
    staleTime: CONSOLE_RESOURCE_STALE_TIME,
    select,
  });
}
