/**
 * Test factories and fakes for the mailbox module.
 *
 * Excluded from the production build (see tsconfig.build.json). Provides small,
 * overridable builders and deterministic fakes for the AI seams so tests never
 * touch a real model.
 */

import type { MailAiMatcher, MailAiMatchResult } from "./rules/conditions.js";
import type { MailDraftGenerator, GeneratedDraft } from "./reply/drafts.js";
import type { ReplyClassifier } from "./reply/tracker.js";
import type { ReplyClassification } from "./reply/types.js";
import type {
  GmailBridge,
  GmailConnectionInfo,
  GmailSendReplyBridgeInput,
} from "./provider-gmail.js";
import type { GmailThreadSnapshot } from "../knowledge/sync_gmail.js";
import { normalizeMailboxMessageId, normalizeMailboxThreadId } from "./ids.js";
import type { MailboxAccount, MailboxMessage, MailboxParticipant, MailboxThread } from "./types.js";
import type { MailboxRule } from "./rules/types.js";

const ACCOUNT_ID = "acct_test";
const OWNER = "owner@company.com";

export function makeAccount(overrides: Partial<MailboxAccount> = {}): MailboxAccount {
  return {
    id: ACCOUNT_ID,
    provider: "gmail",
    providerAccountId: OWNER,
    email: OWNER,
    capabilities: ["mail.read", "mail.modify", "mail.send", "mail.draft"],
    status: "connected",
    ...overrides,
  };
}

let msgSeq = 0;

export function makeMessage(overrides: Partial<MailboxMessage> = {}): MailboxMessage {
  msgSeq += 1;
  const providerMessageId = overrides.providerMessageId ?? `gmail-msg-${msgSeq}`;
  const from: MailboxParticipant = overrides.from ?? { email: "sender@example.com" };
  const isOutbound = overrides.isOutbound ?? from.email.toLowerCase() === OWNER;
  return {
    id: normalizeMailboxMessageId({ provider: "gmail", accountId: ACCOUNT_ID, providerMessageId }),
    accountId: ACCOUNT_ID,
    provider: "gmail",
    providerThreadId: overrides.providerThreadId ?? "gmail-thread-1",
    providerMessageId,
    headerMessageId: overrides.headerMessageId ?? `<${providerMessageId}@mail>`,
    subject: overrides.subject ?? "Test subject",
    from,
    to: overrides.to ?? [{ email: OWNER }],
    cc: overrides.cc ?? [],
    bcc: overrides.bcc ?? [],
    sentAt: overrides.sentAt ?? Date.now(),
    snippet: overrides.snippet,
    textBody: overrides.textBody ?? "Test body",
    attachments: overrides.attachments ?? [],
    labels: overrides.labels ?? [],
    folderIds: overrides.folderIds ?? [],
    unread: overrides.unread ?? true,
    draft: false,
    sent: isOutbound,
    inbox: true,
    isOutbound,
  };
}

export function makeThread(overrides: Partial<MailboxThread> = {}): MailboxThread {
  const providerThreadId = overrides.providerThreadId ?? "gmail-thread-1";
  const messages = overrides.messages ?? [makeMessage({ providerThreadId })];
  return {
    id:
      overrides.id ??
      normalizeMailboxThreadId({ provider: "gmail", accountId: ACCOUNT_ID, providerThreadId }),
    accountId: ACCOUNT_ID,
    provider: "gmail",
    providerThreadId,
    subject: overrides.subject ?? messages[0]?.subject ?? "Test subject",
    participants: overrides.participants ?? [{ email: "sender@example.com" }, { email: OWNER }],
    latestMessageAt: overrides.latestMessageAt ?? messages.at(-1)?.sentAt ?? Date.now(),
    unread: overrides.unread ?? true,
    categories: overrides.categories ?? [],
    labels: overrides.labels ?? [],
    folderIds: overrides.folderIds ?? [],
    snippet: overrides.snippet,
    summary: overrides.summary,
    messages,
  };
}

export function makeRule(overrides: Partial<MailboxRule> = {}): MailboxRule {
  const now = Date.now();
  return {
    id: overrides.id ?? "rule_1",
    accountId: ACCOUNT_ID,
    name: overrides.name ?? "Test rule",
    enabled: overrides.enabled ?? true,
    version: overrides.version ?? 1,
    systemType: overrides.systemType,
    runOnThreads: overrides.runOnThreads ?? true,
    conditionalOperator: overrides.conditionalOperator ?? "AND",
    conditions: overrides.conditions ?? [],
    aiInstructions: overrides.aiInstructions,
    learnedPatternIds: overrides.learnedPatternIds ?? [],
    actions: overrides.actions ?? [],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

export const OWNER_EMAIL = OWNER;
export const TEST_ACCOUNT_ID = ACCOUNT_ID;

// --- deterministic fakes ---------------------------------------------------

export class FakeAiMatcher implements MailAiMatcher {
  constructor(private readonly result: MailAiMatchResult = { matched: true, confidence: 1 }) {}
  calls = 0;
  async match(): Promise<MailAiMatchResult> {
    this.calls += 1;
    return this.result;
  }
}

export class FakeReplyClassifier implements ReplyClassifier {
  constructor(
    private readonly inbound: ReplyClassification = { status: "needs_reply", reason: "question" },
    private readonly expects = true,
  ) {}
  async classifyInbound(): Promise<ReplyClassification> {
    return this.inbound;
  }
  async outboundExpectsReply(): Promise<boolean> {
    return this.expects;
  }
}

export class FakeDraftGenerator implements MailDraftGenerator {
  calls = 0;
  constructor(private readonly draft?: Partial<GeneratedDraft>) {}
  async generate(input: { thread: MailboxThread }): Promise<GeneratedDraft> {
    this.calls += 1;
    const lastInbound = [...input.thread.messages].reverse().find((m) => !m.isOutbound);
    return {
      subject: `Re: ${input.thread.subject}`,
      bodyText: this.draft?.bodyText ?? `Draft #${this.calls}`,
      to: this.draft?.to ?? (lastInbound ? [lastInbound.from] : []),
      cc: this.draft?.cc ?? [],
      bcc: [],
      confidence: this.draft?.confidence ?? 0.7,
      reasoningSummary: "fake",
    };
  }
}

export function makeGmailSnapshot(
  overrides: Partial<GmailThreadSnapshot> = {},
): GmailThreadSnapshot {
  return {
    threadId: overrides.threadId ?? "gmail-thread-1",
    threadUrl: overrides.threadUrl ?? "https://mail.google.com/mail/u/0/#inbox/gmail-thread-1",
    subject: overrides.subject ?? "Hello",
    from: overrides.from,
    to: overrides.to,
    date: overrides.date,
    unread: overrides.unread,
    importance: overrides.importance,
    summary: overrides.summary,
    messages: overrides.messages ?? [
      {
        id: "m1",
        from: '"Ada Lovelace" <ada@example.com>',
        to: `${OWNER}`,
        date: "Mon, 12 Jun 2026 10:00:00 +0000",
        subject: "Hello",
        body: "Hi there, can you confirm?",
        messageIdHeader: "<m1@mail>",
      },
    ],
  };
}

export class FakeGmailBridge implements GmailBridge {
  sentReplies: GmailSendReplyBridgeInput[] = [];
  archived: string[] = [];
  private snapshots = new Map<string, GmailThreadSnapshot>();
  private failure?: () => never;

  constructor(
    private readonly info: GmailConnectionInfo = {
      connected: true,
      hasRequiredScope: true,
      missingScopes: [],
      email: OWNER,
    },
  ) {}

  setSnapshot(snapshot: GmailThreadSnapshot): void {
    this.snapshots.set(snapshot.threadId, snapshot);
  }

  failWith(fn: () => never): void {
    this.failure = fn;
  }

  async listThreads(): Promise<{ snapshots: GmailThreadSnapshot[]; nextCursor: string | null }> {
    if (this.failure) this.failure();
    return { snapshots: [...this.snapshots.values()], nextCursor: null };
  }

  async getThreadSnapshot(providerThreadId: string): Promise<GmailThreadSnapshot | null> {
    return this.snapshots.get(providerThreadId) ?? null;
  }

  async archiveThread(providerThreadId: string): Promise<void> {
    this.archived.push(providerThreadId);
  }
  async trashThread(): Promise<void> {}
  async markThreadRead(): Promise<void> {}
  async sendReply(
    input: GmailSendReplyBridgeInput,
  ): Promise<{ messageId?: string; threadId?: string }> {
    this.sentReplies.push(input);
    return { messageId: "sent-1", threadId: input.threadId };
  }
  async getConnectionInfo(): Promise<GmailConnectionInfo> {
    return this.info;
  }
  triggerSync(): void {}
}
