/**
 * Reply memory.
 *
 * Captures how the account owner likes to respond to a given sender, domain, or
 * situation so future drafts sound like them. Memories are local-first and
 * user-deletable (email-004 privacy requirement). Selection prefers the most
 * specific match (exact sender over domain) and higher confidence.
 */

import { localId } from "../ids.js";
import type { MailboxStore } from "../store.js";
import type { MailboxReplyMemory } from "./types.js";

export function findRelevantReplyMemories(
  memories: MailboxReplyMemory[],
  senderEmail: string,
  limit = 3,
): MailboxReplyMemory[] {
  const email = senderEmail.toLowerCase();
  const domain = email.split("@")[1] ?? "";

  const scored = memories
    .map((memory) => {
      let specificity = 0;
      if (memory.senderEmail && memory.senderEmail.toLowerCase() === email) specificity = 2;
      else if (memory.senderDomain && memory.senderDomain.toLowerCase() === domain) specificity = 1;
      else if (!memory.senderEmail && !memory.senderDomain) specificity = 0.5;
      return { memory, specificity };
    })
    .filter((entry) => entry.specificity > 0)
    .sort((a, b) => b.specificity - a.specificity || b.memory.confidence - a.memory.confidence);

  return scored.slice(0, limit).map((entry) => entry.memory);
}

export type RecordReplyMemoryInput = {
  accountId: string;
  senderEmail?: string;
  senderDomain?: string;
  pattern: string;
  instruction: string;
  examples?: string[];
  confidence?: number;
  store: MailboxStore;
};

/**
 * Upserts a reply memory, reinforcing confidence if an equivalent memory (same
 * scope + pattern) already exists rather than piling up duplicates.
 */
export async function recordReplyMemory(
  input: RecordReplyMemoryInput,
): Promise<MailboxReplyMemory> {
  const existing = (await input.store.listReplyMemories(input.accountId)).find(
    (memory) =>
      memory.pattern === input.pattern &&
      (memory.senderEmail ?? "") === (input.senderEmail ?? "") &&
      (memory.senderDomain ?? "") === (input.senderDomain ?? ""),
  );

  const now = Date.now();
  if (existing) {
    const reinforced: MailboxReplyMemory = {
      ...existing,
      instruction: input.instruction,
      examples: mergeExamples(existing.examples, input.examples),
      confidence: Math.min(1, existing.confidence + 0.1),
      updatedAt: now,
    };
    await input.store.upsertReplyMemory(reinforced);
    return reinforced;
  }

  const memory: MailboxReplyMemory = {
    id: localId("replymem"),
    accountId: input.accountId,
    senderEmail: input.senderEmail?.toLowerCase(),
    senderDomain: input.senderDomain?.toLowerCase(),
    pattern: input.pattern,
    instruction: input.instruction,
    examples: input.examples,
    confidence: input.confidence ?? 0.6,
    createdAt: now,
    updatedAt: now,
  };
  await input.store.upsertReplyMemory(memory);
  return memory;
}

function mergeExamples(existing: string[] | undefined, incoming: string[] | undefined): string[] {
  const set = new Set([...(existing ?? []), ...(incoming ?? [])]);
  return [...set].slice(0, 5);
}
