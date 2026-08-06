import { describe, expect, it } from "vitest";
import type { MailboxSenderProfile, MailboxStore } from "./store.js";
import type { MailboxMessage, MailboxThread } from "./types.js";
import { hasPriorContact, isMachineSender, updateSenderProfiles } from "./sender-profiles.js";

const SELF = new Set(["me@mycorp.com"]);

/** Just the three sender-profile methods the producer touches. */
function fakeStore(): MailboxStore & { rows: Map<string, MailboxSenderProfile> } {
  const rows = new Map<string, MailboxSenderProfile>();
  const store = {
    rows,
    async upsertSenderProfile(profile: MailboxSenderProfile) {
      rows.set(`${profile.accountId}:${profile.email}`, profile);
    },
    async getSenderProfile(accountId: string, email: string) {
      return rows.get(`${accountId}:${email}`) ?? null;
    },
    async listSenderProfiles(accountId: string) {
      return [...rows.values()].filter((row) => row.accountId === accountId);
    },
  } as unknown as MailboxStore & { rows: Map<string, MailboxSenderProfile> };
  return store;
}

function message(over: Partial<MailboxMessage> & Pick<MailboxMessage, "from">): MailboxMessage {
  return {
    id: over.id ?? "m1",
    accountId: "acct",
    provider: "gmail",
    providerThreadId: "t1",
    providerMessageId: over.providerMessageId ?? "m1",
    subject: "Re: pricing",
    to: [],
    cc: [],
    bcc: [],
    sentAt: over.sentAt ?? 1_700_000_000_000,
    attachments: [],
    labels: [],
    folderIds: [],
    unread: false,
    ...over,
  } as MailboxMessage;
}

function thread(messages: MailboxMessage[]): MailboxThread {
  return {
    id: "t1",
    accountId: "acct",
    provider: "gmail",
    providerThreadId: "t1",
    subject: "Re: pricing",
    participants: [],
    latestMessageAt: 1_700_000_000_000,
    unread: false,
    categories: [],
    labels: [],
    folderIds: [],
    messages,
  } as MailboxThread;
}

describe("updateSenderProfiles", () => {
  it("counts an inbound sender without claiming prior contact", async () => {
    const store = fakeStore();
    await updateSenderProfiles({
      store,
      accountId: "acct",
      selfEmails: SELF,
      thread: thread([message({ from: { name: "Sarah Chen", email: "sarah@acme.com" } })]),
    });

    const profile = await store.getSenderProfile("acct", "sarah@acme.com");
    expect(profile?.messageCount).toBe(1);
    expect(profile?.domain).toBe("acme.com");
    expect(profile?.displayName).toBe("Sarah Chen");
    // Never engaged: this is exactly the thread that must not be published.
    expect(profile?.hasPriorContact).toBe(false);
    expect(profile?.isColdEmail).toBe(true);
  });

  it("marks prior contact once the user has sent anything on the thread", async () => {
    const store = fakeStore();
    await updateSenderProfiles({
      store,
      accountId: "acct",
      selfEmails: SELF,
      thread: thread([
        message({ id: "m1", from: { email: "sarah@acme.com" } }),
        message({ id: "m2", from: { email: "me@mycorp.com" } }),
      ]),
    });

    expect(await hasPriorContact(store, "acct", "sarah@acme.com")).toBe(true);
    const profile = await store.getSenderProfile("acct", "sarah@acme.com");
    expect(profile?.isColdEmail).toBe(false);
    // The user's own address never becomes a sender profile.
    expect(await store.getSenderProfile("acct", "me@mycorp.com")).toBeNull();
  });

  it("accumulates across ticks instead of resetting", async () => {
    const store = fakeStore();
    const input = {
      store,
      accountId: "acct",
      selfEmails: SELF,
      thread: thread([message({ from: { email: "sarah@acme.com" }, sentAt: 1_000 })]),
    };
    await updateSenderProfiles(input);
    await updateSenderProfiles({
      ...input,
      thread: thread([message({ id: "m2", from: { email: "sarah@acme.com" }, sentAt: 5_000 })]),
    });

    const profile = await store.getSenderProfile("acct", "sarah@acme.com");
    expect(profile?.messageCount).toBe(2);
    expect(profile?.firstSeenAt).toBe(1_000);
    expect(profile?.lastSeenAt).toBe(5_000);
  });

  it("keeps a signature-derived title local and raises confidence on repetition", async () => {
    const store = fakeStore();
    const body = ["-- ", "Sarah Chen", "VP Engineering", "m: +1 415 555 0134"].join("\n");
    const input = {
      store,
      accountId: "acct",
      selfEmails: SELF,
      thread: thread([
        message({ from: { name: "Sarah Chen", email: "sarah@acme.com" }, textBody: body }),
      ]),
    };

    await updateSenderProfiles(input);
    let profile = await store.getSenderProfile("acct", "sarah@acme.com");
    expect(profile?.signature?.title).toBe("VP Engineering");
    expect(profile?.signature?.confidence).toBe(0.5);
    // Parsed, stored locally, and never published as relationship evidence.
    expect(profile?.signature?.phone).toBe("+1 415 555 0134");

    await updateSenderProfiles({
      ...input,
      thread: thread([
        message({ id: "m2", from: { name: "Sarah Chen", email: "sarah@acme.com" }, textBody: body }),
      ]),
    });
    profile = await store.getSenderProfile("acct", "sarah@acme.com");
    expect(profile?.signature?.seenInThreads).toBe(2);
    expect(profile?.signature?.confidence).toBe(0.6);
  });

  it("flags machine senders as newsletters", async () => {
    const store = fakeStore();
    await updateSenderProfiles({
      store,
      accountId: "acct",
      selfEmails: SELF,
      thread: thread([message({ from: { email: "no-reply@acme.com" } })]),
    });
    expect((await store.getSenderProfile("acct", "no-reply@acme.com"))?.isNewsletter).toBe(true);

    expect(isMachineSender("noreply@acme.com")).toBe(true);
    expect(isMachineSender("mailer-daemon@acme.com")).toBe(true);
    expect(isMachineSender("notifications@acme.com")).toBe(true);
    expect(isMachineSender("sarah@acme.com")).toBe(false);
  });
});

describe("departure signals from bounces", () => {
  // The bounce arrives from mailer-daemon and is about someone else, so the
  // message carrying the evidence is exactly the one the machine-sender skip
  // discards. These assert it is read before that skip, and attributed to the
  // right person.
  async function runWith(msgs: MailboxMessage[], store = fakeStore()) {
    await updateSenderProfiles({
      store,
      accountId: "acct",
      selfEmails: SELF,
      thread: thread(msgs),
    });
    return store;
  }

  it("annotates a known contact when their address hard-bounces", async () => {
    const store = fakeStore();
    // Established correspondence first — a bounce for a stranger is a typo.
    await runWith([message({ from: { email: "sarah@acme.com", name: "Sarah Chen" } })], store);

    await runWith(
      [
        message({
          id: "m2",
          from: { email: "mailer-daemon@googlemail.com" },
          subject: "Delivery Status Notification (Failure)",
          textBody: "Your message to sarah@acme.com was not delivered.\n550 5.1.1 user unknown",
        }),
      ],
      store,
    );

    const sarah = await store.getSenderProfile("acct", "sarah@acme.com");
    expect(sarah?.departure?.kind).toBe("recipient_unknown");
    expect(sarah?.departure?.evidence).toMatch(/user unknown/i);
  });

  it("does not invent a profile for an address never corresponded with", async () => {
    // A bounce for an unknown address is a mistyped recipient, not a departure,
    // and creating a contact from one would populate the graph with typos.
    const store = await runWith([
      message({
        from: { email: "mailer-daemon@googlemail.com" },
        subject: "Delivery Status Notification (Failure)",
        textBody: "Your message to nobody@acme.com failed.\n550 5.1.1 user unknown",
      }),
    ]);
    expect(await store.getSenderProfile("acct", "nobody@acme.com")).toBeNull();
  });

  it("leaves a contact untouched when the bounce is transient", async () => {
    const store = fakeStore();
    await runWith([message({ from: { email: "sarah@acme.com" } })], store);
    await runWith(
      [
        message({
          id: "m2",
          from: { email: "mailer-daemon@acme.com" },
          subject: "Undeliverable",
          textBody: "sarah@acme.com: mailbox full, will retry.",
        }),
      ],
      store,
    );
    expect((await store.getSenderProfile("acct", "sarah@acme.com"))?.departure).toBeUndefined();
  });

  it("does not mark the messenger when a colleague reports someone else's departure", async () => {
    const store = fakeStore();
    await runWith([message({ from: { email: "tom@acme.com" } })], store);
    await runWith(
      [
        message({
          id: "m2",
          from: { email: "tom@acme.com" },
          subject: "Re: intro",
          textBody: "Sarah has left the company, I am picking this up.",
        }),
      ],
      store,
    );
    expect((await store.getSenderProfile("acct", "tom@acme.com"))?.departure).toBeUndefined();
  });
});
