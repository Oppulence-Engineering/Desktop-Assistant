import type { RelationshipObservationInput } from "@x/shared/relationships";
import { organizationDomain } from "@x/shared/email-domain";
import type { MailboxParticipant, MailboxThread } from "../mailbox/types.js";
import { isMachineSender } from "../mailbox/sender-profiles.js";

/**
 * Email as relationship evidence — metadata only.
 *
 * The desktop has never published anything from email, so the inbox, which is the
 * densest record of who you actually deal with, contributes nothing to relationship
 * state. This closes that, under two hard constraints:
 *
 *   1. **No content.** No subject, no body, no snippet, no attachment names. The
 *      backend's own mail index is explicit that it stores "metadata only — never
 *      bodies or snippets", and the desktop is a *separate consent surface* whose
 *      settings copy has never promised to send email text. Subjects leak deal
 *      names, salaries, legal matters and health. If they ever earn their keep they
 *      get their own switch and their own sentence.
 *   2. **No bulk mail.** Without suppression the graph fills with `newsletter@` and
 *      every real contact is buried. The rule is "you replied to them, or you had
 *      talked before" — the honest definition of a relationship.
 *
 * Silence is the common, correct outcome. An inbox is mostly not relationships.
 */

/** Beyond this a Date header is broken or forged, not merely odd. */
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;
const MIN_PLAUSIBLE_MS = Date.parse("2004-01-01T00:00:00Z");

export type EmailSkipReason =
  | "no_external_participant"
  | "all_public_mailboxes"
  | "machine_sender"
  | "no_engagement"
  | "multiple_organizations"
  | "no_messages";

export interface EmailThreadEvidenceArgs {
  thread: MailboxThread;
  selfEmails: Set<string>;
  sourceAccountId?: string;
  /**
   * Whether the user has ever engaged with anyone on this thread, resolved by the
   * caller from the local sender profiles. Together with an outbound message it is
   * the whole publish gate.
   */
  hasPriorContact?: boolean;
  /** Signature-derived titles keyed by lowercased email. Local, opt-in. */
  titles?: Map<string, { title: string; confidence: number }>;
  now?: () => number;
}

function normalize(email: string | undefined): string | undefined {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || undefined;
}

/** Distinct organization domains among the external participants. */
function organizationDomains(external: MailboxParticipant[]): string[] {
  return [
    ...new Set(
      external
        .map((participant) => organizationDomain(participant.email))
        .filter((domain): domain is string => !!domain),
    ),
  ];
}

function externalParticipants(
  thread: MailboxThread,
  selfEmails: Set<string>,
): MailboxParticipant[] {
  const seen = new Map<string, MailboxParticipant>();
  for (const message of thread.messages) {
    for (const participant of [message.from, ...message.to, ...message.cc]) {
      const email = normalize(participant.email);
      if (!email || selfEmails.has(email)) continue;
      const existing = seen.get(email);
      // Prefer the richest name we saw for this address.
      if (!existing || (!existing.name && participant.name)) {
        seen.set(email, { ...participant, email });
      }
    }
  }
  return [...seen.values()];
}

/**
 * Clamp a provider timestamp into a plausible range.
 *
 * Forged and broken `Date:` headers are routine, and a far-future value poisons
 * `lastTouchAt` and every recency detector downstream — a single spoofed header
 * would make an account look permanently fresh.
 */
export function clampOccurredAt(sentAt: number, now: number): { at: number; clamped: boolean } {
  if (!Number.isFinite(sentAt) || sentAt < MIN_PLAUSIBLE_MS || sentAt > now + MAX_FUTURE_SKEW_MS) {
    return { at: now, clamped: true };
  }
  return { at: sentAt, clamped: false };
}

/** Why the thread produced nothing. For diagnostics, not for the user. */
export function emailThreadSkipReason(args: EmailThreadEvidenceArgs): EmailSkipReason | undefined {
  const { thread, selfEmails } = args;
  if (thread.messages.length === 0) return "no_messages";

  const external = externalParticipants(thread, selfEmails);
  if (external.length === 0) return "no_external_participant";
  if (external.every((participant) => isMachineSender(participant.email))) return "machine_sender";

  const domains = organizationDomains(external);
  if (domains.length === 0) return "all_public_mailboxes";
  // A thread spanning two companies is the same ambiguity a multi-organization
  // meeting has, and it gets the same answer: publish nothing rather than guess.
  //
  // Declining to *name* the account was not enough. With no account domain, the
  // counterparty filter below matched participants whose organization domain was
  // also undefined -- the public-mailbox people -- so a thread between two
  // companies published an account anchored on somebody's personal Gmail address
  // and dropped both real companies. Skipping is the only correct outcome.
  if (domains.length > 1) return "multiple_organizations";

  const userSent = thread.messages.some((message) =>
    selfEmails.has(normalize(message.from.email) ?? ""),
  );
  if (userSent) return undefined;

  return args.hasPriorContact ? undefined : "no_engagement";
}

/**
 * One metadata-only observation for a thread's latest message, or null.
 */
export function emailThreadObservation(
  args: EmailThreadEvidenceArgs,
): RelationshipObservationInput | null {
  if (emailThreadSkipReason(args)) return null;

  const { thread, selfEmails } = args;
  const now = args.now?.() ?? Date.now();
  const external = externalParticipants(thread, selfEmails);

  const ordered = [...thread.messages].sort((a, b) => a.sentAt - b.sentAt);
  const latest = ordered[ordered.length - 1];
  const first = ordered[0];

  let outbound = 0;
  let inbound = 0;
  let attachmentCount = 0;
  for (const message of ordered) {
    if (selfEmails.has(normalize(message.from.email) ?? "")) outbound += 1;
    else inbound += 1;
    attachmentCount += message.attachments?.length ?? 0;
  }
  const latestOutbound = selfEmails.has(normalize(latest.from.email) ?? "");

  // Exactly one, guaranteed by the skip check above. Never undefined here: an
  // undefined account domain made this filter select the public-mailbox
  // participants instead of the real ones.
  const accountDomain = organizationDomains(external)[0];
  const counterparties = external.filter(
    (participant) => organizationDomain(participant.email) === accountDomain,
  );
  const primary = counterparties.length === 1 ? counterparties[0] : undefined;

  const occurred = clampOccurredAt(latest.sentAt, now);
  const firstAt = clampOccurredAt(first.sentAt, now);

  return {
    ...(primary?.email ? { primaryEmail: primary.email } : {}),
    ...(accountDomain ? { accountDomain } : {}),
    // Never the subject.
    displayName: accountDomain ?? primary?.name ?? primary?.email ?? "Unknown",
    source: "gmail",
    ...(args.sourceAccountId ? { sourceAccountId: args.sourceAccountId } : {}),
    // Gmail message ids are immutable and never reused, so keying on the LATEST
    // message makes each reply its own idempotent observation while a re-sync of an
    // unchanged thread re-derives the identical id. Not the RFC Message-ID header
    // (attacker-controlled), and not a content hash (a parser-version bump would
    // republish the entire cache).
    externalId: `gmail-thread:${thread.providerThreadId}:${latest.providerMessageId}`,
    sourceVersion: "1",
    eventType: "email_exchanged",
    occurredAt: new Date(occurred.at).toISOString(),
    summary: `${ordered.length}-message thread with ${accountDomain ?? "an external contact"}`,
    channel: "email",
    direction: latestOutbound ? "outbound" : "inbound",
    participants: counterparties.map((participant) => ({
      displayName: participant.name?.trim() || participant.email,
      email: participant.email,
      role: "contact",
      ...(args.titles?.get(participant.email)
        ? { title: args.titles.get(participant.email)!.title }
        : {}),
    })),
    // Omitted entirely. `payload` is the sealed channel that carries transcript
    // text; email bodies must never reach it, and omitting it keeps this path clear
    // of evidence-key infrastructure.
    normalizedFacts: {
      provider: "gmail",
      thread_id: thread.providerThreadId,
      message_id: latest.providerMessageId,
      direction: latestOutbound ? "outbound" : "inbound",
      message_count: ordered.length,
      outbound_count: outbound,
      inbound_count: inbound,
      first_message_at: new Date(firstAt.at).toISOString(),
      last_message_at: new Date(occurred.at).toISOString(),
      participant_count: thread.participants.length,
      external_participant_count: external.length,
      has_attachments: attachmentCount > 0,
      // Count only. Filenames are content.
      attachment_count: attachmentCount,
      reply_state: latestOutbound ? "awaiting_reply" : "needs_reply",
      is_first_contact: ordered.length === 1,
      subject_present: !!thread.subject?.trim(),
      ...(occurred.clamped ? { occurred_at_clamped: true } : {}),
    },
  };
}

/**
 * The observation that carries a departure to the graph.
 *
 * Separate from `emailThreadObservation` because the thread rules do not apply and
 * would suppress it: a bounce arrives from `mailer-daemon`, which `machine_sender`
 * skips, and it is one message with no engagement, which `no_engagement` skips.
 * Those rules exist to keep bulk mail out of the graph; a delivery report about
 * someone you already correspond with is the opposite of bulk mail.
 *
 * Carries the mail system's own sentence as the summary. `evidence` is text the
 * server will store, so it is bounded here — a bounce report can quote an entire
 * original message, and the point is the sentence that names the failure, not the
 * thread it was attached to.
 */
export function departureObservation(args: {
  departure: {
    email: string;
    displayName?: string;
    kind: "left_organization" | "recipient_unknown";
    evidence: string;
    observedAt: number;
    externalId: string;
  };
  sourceAccountId: string;
  now?: () => number;
}): RelationshipObservationInput | null {
  const { departure } = args;
  const email = departure.email.trim().toLowerCase();
  if (!email) return null;
  // A bounce for a public mailbox says nothing about a person, and a machine
  // address cannot depart.
  const accountDomain = organizationDomain(email);
  if (!accountDomain || isMachineSender(email)) return null;

  const now = args.now?.() ?? Date.now();
  const occurred = clampOccurredAt(departure.observedAt, now);
  const displayName = departure.displayName?.trim() || email;

  return {
    primaryEmail: email,
    accountDomain,
    displayName: accountDomain,
    source: "gmail",
    sourceAccountId: args.sourceAccountId,
    externalId: departure.externalId,
    sourceVersion: "1",
    eventType: "contact_departed",
    occurredAt: new Date(occurred.at).toISOString(),
    summary:
      departure.kind === "left_organization"
        ? `${displayName} replied that they have left ${accountDomain}`
        : `Mail to ${displayName} was rejected as an unknown recipient`,
    channel: "email",
    // The mail system spoke, not the user.
    direction: "inbound",
    participants: [{ displayName, email, role: "contact" }],
    normalizedFacts: {
      provider: "gmail",
      departure_kind: departure.kind,
      // The one piece of message text that crosses, and only because a claim that
      // someone has left is unreviewable without it. Truncated: the sentence is
      // the evidence, the quoted original is not.
      departure_evidence: departure.evidence.slice(0, 300),
      ...(occurred.clamped ? { occurred_at_clamped: true } : {}),
    },
  };
}
