import { ListConsoleResources200Response } from "@/lib/api/generated/zod/console/console";
import {
  isConsoleRouteUnavailable,
  SyncedConsolePreferencesSchema,
  type ConsolePreferences,
  type ConsoleResource,
  type ConsoleResourceKind,
} from "@/lib/console/console-contract";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

const PREFERENCES_PATH = "/console/preferences";

function resourcesPath(kind: ConsoleResourceKind): string {
  const params = new URLSearchParams({ kind, limit: "100", offset: "0" });
  return `/console/resources?${params.toString()}`;
}

export async function loadConsolePreferences(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<ConsolePreferences> {
  return request({
    path: PREFERENCES_PATH,
    schema: SyncedConsolePreferencesSchema,
    signal,
  });
}

export async function loadConsoleResources(
  request: RequestJsonFn,
  kind: ConsoleResourceKind,
  signal?: AbortSignal,
): Promise<ConsoleResource[]> {
  try {
    const page = await request({
      path: resourcesPath(kind),
      schema: ListConsoleResources200Response,
      signal,
    });
    return page.resources as ConsoleResource[];
  } catch (error) {
    if (isConsoleRouteUnavailable(error)) return [];
    throw error;
  }
}

export function fetchConsolePreferences(signal?: AbortSignal): Promise<ConsolePreferences> {
  return loadConsolePreferences(requestJson, signal);
}

export function fetchConsoleResources(
  kind: ConsoleResourceKind,
  signal?: AbortSignal,
): Promise<ConsoleResource[]> {
  return loadConsoleResources(requestJson, kind, signal);
}
