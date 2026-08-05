import { describe, expect, it } from "vitest";
import type { MailboxMessage, MailboxThread } from "../mailbox/types.js";
import {
  clampOccurredAt,
  emailThreadObservation,
  emailThreadSkipReason,
} from "./email-evidence.js";

const SELF = new Set(["me@mycorp.com"]);
const NOW = Date.parse("2026-08-04T12:00:00.000Z");

function message(over: Partial<MailboxMessage> & Pick<MailboxMessage, "from">): MailboxMessage {
  return {
    id: over.id ?? "m1",
    accountId: "acct",
    provider: "gmail",
    providerThreadId: "t1",
    providerMessageId: over.providerMessageId ?? over.id ?? "m1",
    subject: "Q3 pricing and the renewal",
    to: [],
    cc: [],
    bcc: [],
    sentAt: over.sentAt ?? NOW - 60_000,
    attachments: [],
    labels: [],
    folderIds: [],
    unread: false,
    ...over,
  } as MailboxMessage;
}

function thread(messages: MailboxMessage[], over: Partial<MailboxThread> = {}): MailboxThread {
  return {
    id: "t1",
    accountId: "acct",
    provider: "gmail",
    providerThreadId: "t1",
    subject: "Q3 pricing and the renewal",
    participants: [],
    latestMessageAt: NOW,
    unread: false,
    categories: [],
    labels: [],
    folderIds: [],
    messages,
    ...over,
  } as MailboxThread;
}

const build = (t: MailboxThread, hasPriorContact = false) =>
  emailThreadObservation({ thread: t, selfEmails: SELF, hasPriorContact, now: () => NOW });

describe("emailThreadObservation", () => {
  it("publishes a thread the user replied to", () => {
    const observation = build(
      thread([
        message({ id: "m1", from: { name: "Sarah Chen", email: "sarah@acme.com" } }),
        message({ id: "m2", from: { email: "me@mycorp.com" }, sentAt: NOW - 30_000 }),
      ]),
    );

    expect(observation).not.toBeNull();
    expect(observation?.source).toBe("gmail");
    expect(observation?.eventType).toBe("email_exchanged");
    expect(observation?.accountDomain).toBe("acme.com");
    expect(observation?.participants?.[0].email).toBe("sarah@acme.com");
    expect(observation?.direction).toBe("outbound");
  });

  it("never sends the subject, the body, or a payload", () => {
    const observation = build(
      thread([
        message({ id: "m1", from: { email: "sarah@acme.com" }, textBody: "our price is $40k" }),
        message({ id: "m2", from: { email: "me@mycorp.com" } }),
      ]),
    );
    const serialized = JSON.stringify(observation);

    expect(observation?.payload).toBeUndefined();
    expect(serialized).not.toContain("Q3 pricing");
    expect(serialized).not.toContain("$40k");
    // The fact that a subject existed is metadata; its text is not.
    expect(observation?.normalizedFacts?.subject_present).toBe(true);
  });

  it("suppresses a cold inbound thread the user never engaged with", () => {
    const cold = thread([message({ from: { email: "sales@acme.com" } })]);
    expect(emailThreadSkipReason({ thread: cold, selfEmails: SELF })).toBe("no_engagement");
    expect(build(cold)).toBeNull();
  });

  it("publishes a cold inbound thread once there is prior contact", () => {
    const known = thread([message({ from: { email: "sarah@acme.com" } })]);
    expect(build(known, true)).not.toBeNull();
    expect(build(known, true)?.direction).toBe("inbound");
  });

  it("suppresses machine senders even after prior contact", () => {
    const bulk = thread([message({ from: { email: "no-reply@acme.com" } })]);
    expect(emailThreadSkipReason({ thread: bulk, selfEmails: SELF, hasPriorContact: true })).toBe(
      "machine_sender",
    );
    expect(build(bulk, true)).toBeNull();
  });

  it("suppresses a thread whose only counterparties are on public mailboxes", () => {
    const personal = thread([
      message({ id: "m1", from: { email: "someone@gmail.com" } }),
      message({ id: "m2", from: { email: "me@mycorp.com" } }),
    ]);
    expect(emailThreadSkipReason({ thread: personal, selfEmails: SELF })).toBe(
      "all_public_mailboxes",
    );
  });

  it("suppresses an internal-only thread", () => {
    const internal = thread([message({ from: { email: "me@mycorp.com" } })]);
    expect(emailThreadSkipReason({ thread: internal, selfEmails: SELF })).toBe(
      "no_external_participant",
    );
  });

  /**
   * A far-future Date header would make the account look permanently fresh and
   * poison every recency detector downstream.
   */
  it("clamps a forged Date header and says so", () => {
    const forged = thread([
      message({
        id: "m1",
        from: { email: "sarah@acme.com" },
        sentAt: Date.parse("2099-01-01T00:00:00Z"),
      }),
      message({ id: "m2", from: { email: "me@mycorp.com" }, sentAt: NOW - 30_000 }),
    ]);
    const observation = build(forged);
    expect(observation?.occurredAt).toBe(new Date(NOW).toISOString());
    expect(observation?.normalizedFacts?.occurred_at_clamped).toBe(true);

    expect(clampOccurredAt(Date.parse("1970-01-01T00:00:00Z"), NOW).clamped).toBe(true);
    expect(clampOccurredAt(NOW - 1000, NOW)).toEqual({ at: NOW - 1000, clamped: false });
  });

  it("keys on the latest message so a re-sync is idempotent and a reply is not", () => {
    const first = thread([
      message({ id: "m1", from: { email: "sarah@acme.com" } }),
      message({ id: "m2", from: { email: "me@mycorp.com" }, sentAt: NOW - 30_000 }),
    ]);
    const again = build(first);
    expect(build(first)?.externalId).toBe(again?.externalId);
    expect(again?.externalId).toBe("gmail-thread:t1:m2");

    const grown = thread([
      ...first.messages,
      message({ id: "m3", from: { email: "sarah@acme.com" }, sentAt: NOW - 10_000 }),
    ]);
    expect(build(grown)?.externalId).toBe("gmail-thread:t1:m3");
  });

  it("counts attachments without naming them", () => {
    const withFile = thread([
      message({
        id: "m1",
        from: { email: "sarah@acme.com" },
        attachments: [
          { filename: "Acme_Contract_Final.pdf", mimeType: "application/pdf" },
        ] as MailboxMessage["attachments"],
      }),
      message({ id: "m2", from: { email: "me@mycorp.com" } }),
    ]);
    const observation = build(withFile);
    expect(observation?.normalizedFacts?.attachment_count).toBe(1);
    expect(JSON.stringify(observation)).not.toContain("Acme_Contract_Final");
  });

  /**
   * Declining to *name* the account was not enough. With no account domain the
   * counterparty filter matched participants whose organization domain was also
   * undefined — the public-mailbox people — so a thread between two companies
   * published an account anchored on somebody's personal Gmail address and
   * dropped both real companies.
   */
  it("publishes nothing when the thread spans two organizations", () => {
    const multi = thread([
      message({ id: "m1", from: { email: "sarah@acme.com" } }),
      message({ id: "m2", from: { email: "zed@globex.com" } }),
      message({ id: "m3", from: { email: "me@mycorp.com" } }),
    ]);
    expect(emailThreadSkipReason({ thread: multi, selfEmails: SELF })).toBe(
      "multiple_organizations",
    );
    expect(build(multi)).toBeNull();
  });

  it("never anchors an account on a personal mailbox that happened to be cc'd", () => {
    const mixed = thread([
      message({ id: "m1", from: { email: "sarah@acme.com" } }),
      message({ id: "m2", from: { email: "zed@globex.com" } }),
      message({ id: "m3", from: { email: "someone@gmail.com" } }),
      message({ id: "m4", from: { email: "me@mycorp.com" } }),
    ]);
    expect(build(mixed)).toBeNull();
  });

  it("still publishes when a personal address is cc'd alongside ONE company", () => {
    const single = thread([
      message({ id: "m1", from: { email: "sarah@acme.com" } }),
      message({ id: "m2", from: { email: "sarah.personal@gmail.com" } }),
      message({ id: "m3", from: { email: "me@mycorp.com" } }),
    ]);
    const observation = build(single);
    expect(observation?.accountDomain).toBe("acme.com");
    // The personal address is not a counterparty of the account.
    expect(observation?.participants?.map((p) => p.email)).toEqual(["sarah@acme.com"]);
  });
});
