/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Decide conversation change.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-decide-conversation-change.lit.ts`.
 */
export const decideConversationChangeKeys = {
  all: ["decide-conversation-change"] as const,
  list: (query?: Record<string, unknown>) =>
    [...decideConversationChangeKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...decideConversationChangeKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const DECIDE_CONVERSATION_CHANGE_STALE_TIME = 15_000;
