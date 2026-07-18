/**
 * Redaction helpers.
 *
 * Email bodies, recipient lists, and tokens must never hit a log line
 * (email-001/email-015). These helpers produce log-safe forms and a trimmed,
 * prompt-safe view of a thread. The prompt view intentionally keeps content the
 * model needs but caps body length and drops nothing that would be a security
 * leak in a log.
 */

import type { MailboxParticipant, MailboxThread } from "../types.js";

const EMAIL_RE = /([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

/** `ada@example.com` -> `a***@example.com`. */
export function redactEmailForLog(email: string): string {
  return email.replace(EMAIL_RE, (_full, first: string, domain: string) => `${first}***${domain}`);
}

/** Redacts every email address in an arbitrary string, for safe logging. */
export function redactStringForLog(text: string): string {
  return text.replace(EMAIL_RE, (_full, first: string, domain: string) => `${first}***${domain}`);
}

export function participantForLog(participant: MailboxParticipant): string {
  return participant.name ?? redactEmailForLog(participant.email);
}

export type PromptSafeMessage = {
  from: string;
  to: string[];
  sentAt: number;
  isOutbound: boolean;
  subject: string;
  body: string;
  hasAttachments: boolean;
};

export type PromptSafeThread = {
  subject: string;
  participants: string[];
  latestMessageAt: number;
  messageCount: number;
  messages: PromptSafeMessage[];
};

/**
 * Produces a trimmed thread view for model prompts: caps body length, keeps only
 * the most recent messages, and normalizes participants to display form.
 */
export function redactThreadForPrompt(
  thread: MailboxThread,
  opts: { maxMessages?: number; maxBodyChars?: number } = {},
): PromptSafeThread {
  const maxMessages = opts.maxMessages ?? 8;
  const maxBodyChars = opts.maxBodyChars ?? 2000;
  const recent = thread.messages.slice(-maxMessages);

  return {
    subject: thread.subject,
    participants: thread.participants.map((p) => p.email),
    latestMessageAt: thread.latestMessageAt,
    messageCount: thread.messages.length,
    messages: recent.map((message) => ({
      from: message.from.email,
      to: message.to.map((p) => p.email),
      sentAt: message.sentAt,
      isOutbound: message.isOutbound,
      subject: message.subject,
      body: (message.textBody ?? message.snippet ?? "").slice(0, maxBodyChars),
      hasAttachments: message.attachments.length > 0,
    })),
  };
}
