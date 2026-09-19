import { z } from "zod";

import {
  CreateConsoleResource201Response,
  GetConsolePreferences200Response,
  PatchConsolePreferencesBody,
} from "@/lib/api/generated/zod/console/console";
import { DashboardRequestError } from "@/lib/api/request-json";

/**
 * Only preferences with a real rowboat-www consumer cross the adapter. The
 * API's wider schema is intentionally not surfaced until matching behavior
 * exists in this client.
 */
export const SyncedConsolePreferencesSchema = GetConsolePreferences200Response.transform(
  ({ defaultAgentSlug, displayName, shareUsageData }) => ({
    defaultAgentSlug,
    displayName,
    shareUsageData,
  }),
);
export const SyncedConsolePreferencesPatchSchema = PatchConsolePreferencesBody.pick({
  defaultAgentSlug: true,
  displayName: true,
  shareUsageData: true,
});

export type ConsolePreferences = z.infer<typeof SyncedConsolePreferencesSchema>;
export type ConsolePreferencesPatch = z.infer<typeof SyncedConsolePreferencesPatchSchema>;
export type ConsoleResource = z.infer<typeof CreateConsoleResource201Response>;
export type ConsoleResourceKind = ConsoleResource["kind"];

export class ConsoleAPIError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ConsoleAPIError";
  }
}

/** Console routes are newer than some deployed rowboat-api builds. */
export function isConsoleRouteUnavailable(error: unknown): boolean {
  if (error instanceof ConsoleAPIError && error.status === 404) return true;
  return error instanceof DashboardRequestError && error.status === 404;
}
