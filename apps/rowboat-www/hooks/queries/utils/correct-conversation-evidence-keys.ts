/**
 * @oppulence-gen kind=mutation
 * Query-key factory and staleTime for Correct conversation evidence.
 * Keep this module free of `"use client"` so server prefetch can import it.
 * Owned by `use-correct-conversation-evidence.lit.ts`.
 */
export const correctConversationEvidenceKeys = {
  all: ["correct-conversation-evidence"] as const,
  list: (query?: Record<string, unknown>) =>
    [...correctConversationEvidenceKeys.all, "list", query ?? {}] as const,
  detail: (id?: string, query?: Record<string, unknown>) =>
    [...correctConversationEvidenceKeys.all, "detail", id ?? "", query ?? {}] as const,
};

export const CORRECT_CONVERSATION_EVIDENCE_STALE_TIME = 15_000;
