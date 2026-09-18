"use client";

import "client-only";

import {
  SupportChatConfigSchema,
  type SupportChatConfig,
  type SupportChatCustomer,
} from "@/lib/api/support/chat-schema";

export { SupportChatConfigSchema, type SupportChatConfig, type SupportChatCustomer };

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
