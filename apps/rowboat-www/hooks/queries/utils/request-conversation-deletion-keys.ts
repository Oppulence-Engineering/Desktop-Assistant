/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Request conversation deletion.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-request-conversation-deletion.lit.ts`.
 */
export const requestConversationDeletionKeys = {
  all: ["request-conversation-deletion"] as const,
  list: (query?: Record<string, unknown>) =>
    [...requestConversationDeletionKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...requestConversationDeletionKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const REQUEST_CONVERSATION_DELETION_STALE_TIME = 15_000;
