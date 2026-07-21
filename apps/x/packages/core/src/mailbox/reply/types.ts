/**
 * Reply-tracking model.
 *
 * A thread tracker records whether the account owner owes a reply, is waiting
 * on someone else, owes a non-email action, or is done. Draft suggestions are
 * user-editable proposed replies that live in Rowboat until the user chooses to
 * materialize them as provider drafts or send. Reply memories capture how the
 * user likes to respond to a sender/pattern so future drafts sound like them.
 */

import type { MailboxParticipant } from "../types.js";

export type ReplyTrackerStatus = "needs_reply" | "awaiting_reply" | "needs_action" | "done";

export type MailboxThreadTracker = {
  id: string;
  accountId: string;
  threadId: string;
  providerThreadId: string;
  status: ReplyTrackerStatus;
  reason?: string;
  confidence?: number;
  dueAt?: number;
  followUpAppliedAt?: number;
  followUpDraftId?: string;
  lastInboundMessageId?: string;
  lastOutboundMessageId?: string;
  notificationSentAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type MailboxDraftSource = "manual" | "rule" | "nudge" | "assistant" | "reply_zero";

export type MailboxDraftStatus =
  | "suggested"
  | "created_provider_draft"
  | "edited"
  | "stale"
  | "sent"
  | "discarded";

export type MailboxMessageCitation = {
  messageId: string;
  quote: string;
};

export type MailboxDraftSuggestion = {
  id: string;
  accountId: string;
  trackerId?: string;
  threadId: string;
  providerThreadId: string;
  providerDraftId?: string;
  /** Fingerprint of the thread's message set the draft was generated from. */
  threadVersion: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  to: MailboxParticipant[];
  cc: MailboxParticipant[];
  bcc: MailboxParticipant[];
  confidence: number;
  reasoningSummary?: string;
  citations?: MailboxMessageCitation[];
  source: MailboxDraftSource;
  status: MailboxDraftStatus;
  createdAt: number;
  updatedAt: number;
};

export type MailboxReplyMemory = {
  id: string;
  accountId: string;
  senderEmail?: string;
  senderDomain?: string;
  pattern: string;
  instruction: string;
  examples?: string[];
  confidence: number;
  createdAt: number;
  updatedAt: number;
};

/** Classification of an inbound message for tracker transitions. */
export type ReplyClassification = {
  status: ReplyTrackerStatus;
  reason?: string;
  confidence?: number;
};

export type ReplyZeroSettings = {
  awaitingReplyDays: number;
  needsReplyDays: number;
  /**
   * Confidence at or above which a provider draft may be created automatically.
   * Below it, the suggestion stays inside Rowboat until the user opens it.
   */
  autoProviderDraftConfidence: number;
  /** Never send automatically regardless of confidence unless explicitly enabled. */
  autoSendEnabled: boolean;
};

export const DEFAULT_REPLY_ZERO_SETTINGS: ReplyZeroSettings = {
  awaitingReplyDays: 3,
  needsReplyDays: 2,
  autoProviderDraftConfidence: 0.8,
  autoSendEnabled: false,
};
