/**
 * Gmail snapshot normalization.
 *
 * Converts the desktop app's existing on-disk Gmail thread snapshot into the
 * provider-neutral {@link MailboxThread}/{@link MailboxMessage} model. All
 * Gmail-specific parsing (raw `From`/`To` header strings, `cid:` handling
 * upstream, attachment save paths) is contained here so nothing above the
 * provider layer ever sees a Gmail shape.
 */

import type { GmailThreadSnapshot } from "../knowledge/sync_gmail.js";

import { normalizeMailboxMessageId, normalizeMailboxThreadId } from "./ids.js";
import type {
  MailboxAccount,
  MailboxAttachment,
  MailboxMessage,
  MailboxParticipant,
  MailboxThread,
  MailboxThreadSummary,
} from "./types.js";

/**
 * Parses a single RFC 5322 address such as `"Ada Lovelace" <ada@x.com>` or
 * `ada@x.com` into a participant. Returns undefined when no address is present.
 */
export function parseAddress(raw: string | undefined): MailboxParticipant | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const angle = trimmed.match(/^(.*?)<([^>]+)>\s*$/);
  if (angle) {
    const name = stripQuotes(angle[1].trim());
    const email = angle[2].trim().toLowerCase();
    if (!email) return undefined;
    return name ? { name, email } : { email };
  }

  // Bare address with no display name.
  const email = trimmed.toLowerCase();
  return { email };
}

/** Splits an address-list header on top-level commas (ignoring commas in quotes). */
export function parseAddressList(raw: string | undefined): MailboxParticipant[] {
  if (!raw) return [];
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of raw) {
    if (char === '"') inQuotes = !inQuotes;
    if (char === "," && !inQuotes) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);

  const result: MailboxParticipant[] = [];
  for (const part of parts) {
    const participant = parseAddress(part);
    if (participant) result.push(participant);
  }
  return result;
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function parseDate(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function sameEmail(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function normalizeAttachments(
  raw: NonNullable<GmailThreadSnapshot["messages"][number]["attachments"]>,
): MailboxAttachment[] {
  return raw.map((att, index) => ({
    id: `att_${index}_${att.filename}`,
    providerAttachmentId: att.savedPath,
    filename: att.filename,
    mimeType: att.mimeType ?? "application/octet-stream",
    sizeBytes: att.sizeBytes,
    inline: false,
    localPath: att.savedPath,
    downloadState: "downloaded",
  }));
}

export function normalizeGmailSnapshot(
  account: MailboxAccount,
  snapshot: GmailThreadSnapshot,
): MailboxThread {
  const provider = "gmail" as const;
  const threadId = normalizeMailboxThreadId({
    provider,
    accountId: account.id,
    providerThreadId: snapshot.threadId,
  });

  const threadDateFallback = parseDate(snapshot.date, Date.now());

  const messages: MailboxMessage[] = snapshot.messages.map((raw, index) => {
    const from = parseAddress(raw.from) ?? { email: "unknown@unknown" };
    const providerMessageId = raw.id ?? `${snapshot.threadId}-${index}`;
    const sentAt = parseDate(raw.date, threadDateFallback);
    const isOutbound = sameEmail(from.email, account.email);

    return {
      id: normalizeMailboxMessageId({ provider, accountId: account.id, providerMessageId }),
      accountId: account.id,
      provider,
      providerThreadId: snapshot.threadId,
      providerMessageId,
      headerMessageId: raw.messageIdHeader,
      subject: raw.subject ?? snapshot.subject ?? "",
      from,
      to: parseAddressList(raw.to),
      cc: parseAddressList(raw.cc),
      bcc: [],
      sentAt,
      snippet: raw.body?.slice(0, 200),
      textBody: raw.body,
      htmlBodyRef: raw.bodyHtml ? `snapshot:${snapshot.threadId}:${providerMessageId}` : undefined,
      attachments: raw.attachments ? normalizeAttachments(raw.attachments) : [],
      labels: [],
      folderIds: [],
      unread: raw.unread ?? false,
      draft: false,
      sent: isOutbound,
      inbox: true,
      isOutbound,
    };
  });

  const participants = dedupeParticipants(messages.flatMap((m) => [m.from, ...m.to, ...m.cc]));
  const latestMessageAt = messages.reduce((max, m) => Math.max(max, m.sentAt), threadDateFallback);

  const categories: string[] = [];
  if (snapshot.importance === "important") categories.push("important");
  if (messages.some((m) => m.attachments.length > 0)) categories.push("attachments");

  return {
    id: threadId,
    accountId: account.id,
    provider,
    providerThreadId: snapshot.threadId,
    subject: snapshot.subject ?? "",
    participants,
    latestMessageAt,
    unread: snapshot.unread ?? messages.some((m) => m.unread),
    categories,
    labels: [],
    folderIds: [],
    snippet: snapshot.latest_email?.slice(0, 200) ?? snapshot.summary,
    summary: snapshot.summary,
    messages,
  };
}

export function threadToSummary(thread: MailboxThread): MailboxThreadSummary {
  return {
    id: thread.id,
    accountId: thread.accountId,
    provider: thread.provider,
    providerThreadId: thread.providerThreadId,
    subject: thread.subject,
    participants: thread.participants,
    latestMessageAt: thread.latestMessageAt,
    unread: thread.unread,
    categories: thread.categories,
    labels: thread.labels,
    snippet: thread.snippet,
    summary: thread.summary,
    messageCount: thread.messages.length,
  };
}

function dedupeParticipants(participants: MailboxParticipant[]): MailboxParticipant[] {
  const seen = new Map<string, MailboxParticipant>();
  for (const participant of participants) {
    const key = participant.email.toLowerCase();
    if (!seen.has(key)) seen.set(key, participant);
  }
  return [...seen.values()];
}
