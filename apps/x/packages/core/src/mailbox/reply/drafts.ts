/**
 * Draft suggestion lifecycle.
 *
 * Reply drafts live inside Rowboat by default and are only materialized as
 * provider drafts when the user opts in (per email-004). The key correctness
 * property here is dedupe: sync sees the same thread many times, and we must not
 * spawn a new draft on every tick. We fingerprint the thread's message set and
 * reuse or refresh the existing draft instead.
 */

import { localId, stableHash } from "../ids.js";
import type { MailboxProvider } from "../provider.js";
import type { MailboxStore } from "../store.js";
import type { MailboxParticipant, MailboxThread } from "../types.js";
import type {
  MailboxDraftSource,
  MailboxDraftSuggestion,
  MailboxMessageCitation,
} from "./types.js";

/** Stable fingerprint of a thread's message set — changes when a message is added. */
export function computeThreadMessageSetVersion(thread: MailboxThread): string {
  return stableHash([
    "thread_message_set_v1",
    thread.providerThreadId,
    ...thread.messages.map((m) => m.providerMessageId).sort(),
  ]);
}

export type GeneratedDraft = {
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  to: MailboxParticipant[];
  cc: MailboxParticipant[];
  bcc: MailboxParticipant[];
  confidence: number;
  reasoningSummary?: string;
  citations?: MailboxMessageCitation[];
};

export interface MailDraftGenerator {
  generate(input: {
    accountId: string;
    thread: MailboxThread;
    source: MailboxDraftSource;
    instruction?: string;
  }): Promise<GeneratedDraft>;
}

export type EnsureDraftInput = {
  accountId: string;
  thread: MailboxThread;
  source: MailboxDraftSource;
  trackerId?: string;
  instruction?: string;
  store: MailboxStore;
  draftGenerator: MailDraftGenerator;
};

export async function ensureSingleDraftSuggestion(
  input: EnsureDraftInput,
): Promise<MailboxDraftSuggestion> {
  const existing = await input.store.findOpenDraftSuggestion({
    accountId: input.accountId,
    threadId: input.thread.id,
    source: input.source,
  });

  const threadVersion = computeThreadMessageSetVersion(input.thread);

  // Never regenerate over a user-edited draft, and never spend a model call to
  // do so — the user's words win regardless of thread changes.
  if (existing && existing.status === "edited") {
    return existing;
  }

  // The thread has not changed since the draft was made — reuse it verbatim.
  if (existing && existing.threadVersion === threadVersion) {
    return existing;
  }

  const generated = await input.draftGenerator.generate({
    accountId: input.accountId,
    thread: input.thread,
    source: input.source,
    instruction: input.instruction,
  });

  if (existing) {
    return input.store.updateDraftSuggestion(existing.id, {
      threadVersion,
      subject: generated.subject,
      bodyText: generated.bodyText,
      bodyHtml: generated.bodyHtml,
      to: generated.to,
      cc: generated.cc,
      bcc: generated.bcc,
      confidence: generated.confidence,
      reasoningSummary: generated.reasoningSummary,
      citations: generated.citations,
      status: "suggested",
    });
  }

  const now = Date.now();
  return input.store.createDraftSuggestion({
    id: localId("draft"),
    accountId: input.accountId,
    trackerId: input.trackerId,
    threadId: input.thread.id,
    providerThreadId: input.thread.providerThreadId,
    threadVersion,
    subject: generated.subject,
    bodyText: generated.bodyText,
    bodyHtml: generated.bodyHtml,
    to: generated.to,
    cc: generated.cc,
    bcc: generated.bcc,
    confidence: generated.confidence,
    reasoningSummary: generated.reasoningSummary,
    citations: generated.citations,
    source: input.source,
    status: "suggested",
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Refuses to send a draft generated from a stale thread. If a new message
 * arrived after generation, the draft is marked stale and the caller must
 * regenerate before sending.
 */
export async function assertDraftStillFresh(input: {
  draft: MailboxDraftSuggestion;
  provider: MailboxProvider;
  store: MailboxStore;
}): Promise<void> {
  const latest = await input.provider.getThread({
    accountId: input.draft.accountId,
    provider: input.provider.kind,
    providerThreadId: input.draft.providerThreadId,
  });

  const latestVersion = computeThreadMessageSetVersion(latest);
  if (latestVersion !== input.draft.threadVersion) {
    await input.store.updateDraftSuggestion(input.draft.id, { status: "stale" });
    throw new Error("Draft was generated from stale thread context. Regenerate before sending.");
  }
}
