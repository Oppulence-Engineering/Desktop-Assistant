"use client";

import "client-only";

import { z } from "zod";

/**
 * Browser-side client for the support chat configuration endpoint.
 *
 * The response carries a per-user bearer credential (the Plain email hash), so
 * it is parsed with a runtime schema rather than trusted by shape: a malformed
 * or unexpected payload must fail closed instead of being handed to Plain.
 */
export const SupportChatConfigSchema = z.object({
  configured: z.boolean(),
  appId: z.string().min(1).optional(),
  customer: z
    .object({
      email: z.string().min(1),
      emailHash: z.string().min(1),
    })
    .optional(),
});

export type SupportChatConfig = z.infer<typeof SupportChatConfigSchema>;

export async function loadSupportChatConfig(): Promise<SupportChatConfig> {
  const response = await fetch("/api/support/chat", {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`support chat config failed: ${String(response.status)}`);
  return SupportChatConfigSchema.parse(await response.json());
}
