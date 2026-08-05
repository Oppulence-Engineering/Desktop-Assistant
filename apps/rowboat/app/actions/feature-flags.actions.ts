"use server";

import { USE_AUTH, USE_BILLING } from "@/app/lib/feature_flags";

/**
 * Server actions always run at request time, so these values reflect the
 * runtime environment. Layouts that are prerendered into route shells (see
 * app/projects/layout.tsx) must read flags through this action rather than
 * importing them directly — a direct import bakes the build machine's env
 * into the static shell.
 */
export async function getAppFlags(): Promise<{
  useAuth: boolean;
  useBilling: boolean;
}> {
  return { useAuth: USE_AUTH, useBilling: USE_BILLING };
}
