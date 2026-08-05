/**
 * Mailbox service facade.
 *
 * The single entry point product code (IPC handlers, the assistant, background
 * sync) calls. It composes the store, provider registry, sync controller, rule
 * engine, action runner, reply tracker, and draft generator into high-level
 * operations, and enforces the flow direction from email-021:
 *
 *   provider adapter -> store -> service -> policy/action engine -> UI/assistant
 *
 * Nothing here reaches around the provider registry to call a provider SDK, and
 * every mutation goes through the action runner's policy gate.
 */

import { localId, normalizeMailboxAccountId } from "./ids.js";
import { MailboxProviderError, serializeMailboxError } from "./errors.js";
import type { MailAiMatcher } from "./rules/conditions.js";
import { MailboxActionRunner } from "./rules/actions.js";
import { MailboxAuditLog } from "./rules/audit.js";
import { MailboxRuleEngine } from "./rules/engine.js";
import { MailboxScheduledActionScheduler } from "./rules/scheduler.js";
import { findActionConflicts, previewRule } from "./rules/preview.js";
import type {
  MailboxAction,
  MailboxActionRun,
  MailboxRule,
  MailboxRulePreview,
} from "./rules/types.js";
import { ensureSingleDraftSuggestion, type MailDraftGenerator } from "./reply/drafts.js";
import { ReplyTrackerService } from "./reply/tracker.js";
import type {
  MailboxDraftSuggestion,
  MailboxThreadTracker,
  ReplyTrackerStatus,
} from "./reply/types.js";
import {
  DefaultMailboxProviderRegistry,
  type MailboxProviderRegistry,
} from "./provider-registry.js";
import { createGmailBridge } from "./provider-gmail-bridge.js";
import type { GmailBridge } from "./provider-gmail.js";
import { MailboxSyncController } from "./sync-controller.js";
import { getMailboxStore } from "./store-fs.js";
import type { MailboxProposal, MailboxStore } from "./store.js";
import { LlmAiMatcher, LlmDraftGenerator, LlmReplyClassifier } from "./ai.js";
import { capabilitiesFromScopes } from "./capabilities.js";
import type { MailboxAccount, MailboxThread, MailboxThreadPage } from "./types.js";

export type MailboxServiceDeps = {
  store: MailboxStore;
  providers: MailboxProviderRegistry;
  syncController: MailboxSyncController;
  ruleEngine: MailboxRuleEngine;
  actionRunner: MailboxActionRunner;
  scheduler: MailboxScheduledActionScheduler;
  replyTracker: ReplyTrackerService;
  draftGenerator: MailDraftGenerator;
  aiMatcher: MailAiMatcher;
  gmailBridge: GmailBridge;
};

const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

export class MailboxService {
  private ensuredGmail = false;

  constructor(private readonly deps: MailboxServiceDeps) {}

  // --- account bootstrap ---------------------------------------------------

  /**
   * Ensures a provider-neutral account row exists for the connected Gmail
   * mailbox, deriving capabilities from the granted scope. Idempotent.
   */
  async ensureGmailAccount(): Promise<MailboxAccount | null> {
    const info = await this.deps.gmailBridge.getConnectionInfo();
    if (!info.email) return null;

    const accountId = normalizeMailboxAccountId({
      provider: "gmail",
      providerAccountId: info.email,
    });
    const capabilities = info.grantedScopes?.length
      ? capabilitiesFromScopes("gmail", info.grantedScopes)
      : capabilitiesFromScopes("gmail", info.hasRequiredScope ? [GMAIL_MODIFY_SCOPE] : []);

    const existing = await this.deps.store.getAccount(accountId);
    const account: MailboxAccount = {
      id: accountId,
      provider: "gmail",
      providerAccountId: info.email,
      email: info.email,
      capabilities,
      status: !info.connected
        ? "needs_reconnect"
        : !info.hasRequiredScope
          ? "missing_scope"
          : existing?.status &&
              existing.status !== "needs_reconnect" &&
              existing.status !== "missing_scope"
            ? existing.status
            : "connected",
      lastSyncAt: existing?.lastSyncAt,
    };

    await this.deps.store.upsertAccount(account);
    this.ensuredGmail = true;
    return account;
  }

  async getAccounts(): Promise<MailboxAccount[]> {
    if (!this.ensuredGmail) await this.ensureGmailAccount();
    return this.deps.store.listAccounts();
  }

  private async resolveAccountId(accountId?: string): Promise<string> {
    if (accountId) return accountId;
    const account =
      (await this.deps.store.getDefaultAccount()) ?? (await this.ensureGmailAccount());
    if (!account)
      throw new MailboxProviderError("No connected mailbox account", "auth_reconnect_required", {
        provider: "gmail",
        operation: "resolveAccount",
        accountId: "",
      });
    return account.id;
  }

  // --- read ----------------------------------------------------------------

  async listThreads(query: {
    accountId?: string;
    queue?: import("./types.js").MailboxQueue;
    limit?: number;
    cursor?: string;
  }): Promise<MailboxThreadPage> {
    const accountId = await this.resolveAccountId(query.accountId);
    const provider = await this.deps.providers.get(accountId);
    const page = await provider.listThreads({ ...query, accountId });
    // Refresh the local summary cache opportunistically.
    for (const summary of page.threads) {
      await this.deps.store.upsertThreadSummary(summary);
    }
    return page;
  }

  async getThread(ref: { accountId?: string; providerThreadId: string }): Promise<MailboxThread> {
    const accountId = await this.resolveAccountId(ref.accountId);
    const provider = await this.deps.providers.get(accountId);
    return provider.getThread({
      accountId,
      provider: provider.kind,
      providerThreadId: ref.providerThreadId,
    });
  }

  async search(query: { accountId?: string; query: string; limit?: number }) {
    const accountId = await this.resolveAccountId(query.accountId);
    const provider = await this.deps.providers.get(accountId);
    return provider.searchMessages({ ...query, accountId });
  }

  async getConnectionStatus(): Promise<MailboxAccount["status"]> {
    const account = await this.ensureGmailAccount();
    return account?.status ?? "needs_reconnect";
  }

  // --- sync ----------------------------------------------------------------

  triggerSync(): void {
    this.deps.gmailBridge.triggerSync();
  }

  /**
   * One background tick: ensure the account, sync it into the local store, run
   * due scheduled actions, and materialize any due follow-up nudges.
   *
   * ⚠️ NOT WIRED, and deliberately so. `sync_gmail.ts` is the live Gmail loop;
   * calling this on a timer would start a *second* independent traversal of the
   * same mailbox with its own cursor — double the quota, and two loops that
   * disagree about what is new. It would also start `scheduler.runDue`, which
   * reaches an LLM draft generator, so wiring it turns on background reply
   * drafting as a side effect.
   *
   * It is kept because the provider-neutral sync path it exercises is what the
   * second provider (Outlook) will need, and it is covered by
   * `sync-controller.test.ts`. Enrichment reads Gmail through
   * `normalizeGmailSnapshot`, which is pure and makes no API calls.
   */
  async onSyncTick(): Promise<void> {
    const account = await this.ensureGmailAccount();
    if (!account) return;
    if (account.status === "connected") {
      await this.deps.syncController.syncAccount(account.id);
    }
    await this.deps.scheduler.runDue(this.deps.actionRunner);
    await this.materializeDueNudges(account.id);
  }

  private async materializeDueNudges(accountId: string): Promise<void> {
    const due = await this.deps.replyTracker.listDueForNudge(accountId);
    for (const tracker of due) {
      try {
        const thread = await this.getThread({
          accountId,
          providerThreadId: tracker.providerThreadId,
        });
        const draft = await ensureSingleDraftSuggestion({
          accountId,
          thread,
          source: "nudge",
          trackerId: tracker.id,
          store: this.deps.store,
          draftGenerator: this.deps.draftGenerator,
        });
        await this.deps.replyTracker.recordNudge(accountId, thread.id, draft.id);
      } catch {
        // A single unavailable thread must not stop the rest of the nudges.
      }
    }
  }

  // --- automation (rules + reply tracking) ---------------------------------

  /** Run rules + reply tracking on a freshly synced thread's latest message. */
  async processThreadAutomation(accountId: string, thread: MailboxThread): Promise<void> {
    const latest = thread.messages.at(-1);
    if (!latest) return;
    await this.deps.ruleEngine.processMessage({
      accountId,
      thread,
      message: latest,
      trigger: "sync",
    });
    await this.deps.replyTracker.processThread(accountId, thread);
  }

  // --- actions -------------------------------------------------------------

  /**
   * Execute a thread-scoped action through the policy gate. Hydrates the thread
   * first so the action runner has the full context it needs.
   */
  async executeThreadAction(input: {
    accountId?: string;
    providerThreadId: string;
    action: MailboxAction;
    source?: "assistant" | "manual";
    approvalToken?: string;
  }): Promise<MailboxActionRun> {
    const accountId = await this.resolveAccountId(input.accountId);
    const thread = await this.getThread({ accountId, providerThreadId: input.providerThreadId });
    const message = thread.messages.at(-1);
    if (!message) throw new Error("Thread has no messages to act on");

    return this.deps.actionRunner.run({
      accountId,
      action: input.action,
      thread,
      message,
      source: input.source ?? "manual",
      approvalToken: input.approvalToken,
    });
  }

  // Compatibility wrappers used by the legacy gmail:* IPC shims.
  async archiveThread(providerThreadId: string, accountId?: string): Promise<MailboxActionRun> {
    return this.executeThreadAction({
      accountId,
      providerThreadId,
      action: { id: localId("act"), type: "archive" },
    });
  }

  async trashThread(providerThreadId: string, accountId?: string): Promise<MailboxActionRun> {
    return this.executeThreadAction({
      accountId,
      providerThreadId,
      action: { id: localId("act"), type: "trash" },
      approvalToken: "user_click",
    });
  }

  async markThreadRead(providerThreadId: string, accountId?: string): Promise<MailboxActionRun> {
    return this.executeThreadAction({
      accountId,
      providerThreadId,
      action: { id: localId("act"), type: "mark_read" },
    });
  }

  /**
   * User-initiated send of a reply/forward. The click is the approval, so this
   * goes straight through the provider; the outcome is returned to the UI rather
   * than thrown so the compose surface can show an inline error.
   */
  async sendReply(input: {
    accountId?: string;
    providerThreadId: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    bodyText: string;
    bodyHtml?: string;
    inReplyToHeaderMessageId?: string;
  }): Promise<{ ok: boolean; providerMessageId?: string; error?: string }> {
    try {
      const accountId = await this.resolveAccountId(input.accountId);
      const provider = await this.deps.providers.get(accountId);
      const sent = await provider.reply({
        accountId,
        providerThreadId: input.providerThreadId,
        inReplyToHeaderMessageId: input.inReplyToHeaderMessageId,
        to: input.to.map((email) => ({ email })),
        cc: input.cc?.map((email) => ({ email })),
        bcc: input.bcc?.map((email) => ({ email })),
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
      });
      return { ok: true, providerMessageId: sent.providerMessageId };
    } catch (error) {
      return { ok: false, error: serializeMailboxError(error).message };
    }
  }

  // --- debug / audit accessors ---------------------------------------------

  getActionRuns(accountId: string, limit?: number) {
    return this.deps.store.listActionRuns(accountId, limit ? { limit } : undefined);
  }

  getRuleRuns(accountId: string, limit?: number) {
    return this.deps.store.listRuleRuns(accountId, limit ? { limit } : undefined);
  }

  // --- rules ---------------------------------------------------------------

  async createRule(
    input: Omit<MailboxRule, "id" | "version" | "createdAt" | "updatedAt"> & { id?: string },
  ): Promise<MailboxRule> {
    const now = Date.now();
    return this.deps.store.createRule({
      ...input,
      id: input.id ?? localId("rule"),
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  async updateRule(id: string, patch: Partial<MailboxRule>): Promise<MailboxRule> {
    const current = await this.deps.store.getRule(id);
    if (!current) throw new Error(`Rule not found: ${id}`);
    // Any change to matching logic bumps the version so prior rule-run dedupe
    // keys do not suppress re-evaluation under the new logic.
    const bumpsVersion =
      patch.conditions !== undefined ||
      patch.conditionalOperator !== undefined ||
      patch.actions !== undefined ||
      patch.aiInstructions !== undefined;
    return this.deps.store.updateRule(id, {
      ...patch,
      version: bumpsVersion ? current.version + 1 : current.version,
    });
  }

  listRules(accountId: string): Promise<MailboxRule[]> {
    return this.deps.store.listRules(accountId);
  }

  deleteRule(id: string): Promise<void> {
    return this.deps.store.deleteRule(id);
  }

  ruleConflicts(rule: Pick<MailboxRule, "actions">) {
    return findActionConflicts(rule.actions);
  }

  async previewRule(input: {
    ruleDraft: MailboxRule;
    sampleThreadIds: string[];
  }): Promise<MailboxRulePreview> {
    return previewRule({
      ruleDraft: input.ruleDraft,
      sampleThreadIds: input.sampleThreadIds,
      store: this.deps.store,
      matcher: this.deps.aiMatcher,
      getThread: async (threadId) => {
        const summary = await this.findSummaryById(input.ruleDraft.accountId, threadId);
        if (!summary) return null;
        return this.getThread({
          accountId: summary.accountId,
          providerThreadId: summary.providerThreadId,
        });
      },
    });
  }

  private async findSummaryById(accountId: string, threadId: string) {
    const page = await this.deps.store.listThreadSummaries({ accountId, limit: 500 });
    return page.threads.find((t) => t.id === threadId) ?? null;
  }

  // --- reply zero ----------------------------------------------------------

  listTrackers(accountId: string, status?: ReplyTrackerStatus): Promise<MailboxThreadTracker[]> {
    return this.deps.store.listTrackers(accountId, status ? { status } : undefined);
  }

  markThreadDone(accountId: string, threadId: string) {
    return this.deps.replyTracker.markDone(accountId, threadId);
  }

  markThreadAwaiting(accountId: string, threadId: string, dueInDays?: number) {
    return this.deps.replyTracker.markAwaiting(accountId, threadId, dueInDays);
  }

  markThreadNeedsAction(accountId: string, threadId: string, reason?: string) {
    return this.deps.replyTracker.markNeedsAction(accountId, threadId, reason);
  }

  listDrafts(accountId: string): Promise<MailboxDraftSuggestion[]> {
    return this.deps.store.listDraftSuggestions(accountId);
  }

  async generateDraft(input: {
    accountId?: string;
    providerThreadId: string;
    instruction?: string;
  }): Promise<MailboxDraftSuggestion> {
    const accountId = await this.resolveAccountId(input.accountId);
    const thread = await this.getThread({ accountId, providerThreadId: input.providerThreadId });
    return ensureSingleDraftSuggestion({
      accountId,
      thread,
      source: "reply_zero",
      instruction: input.instruction,
      store: this.deps.store,
      draftGenerator: this.deps.draftGenerator,
    });
  }

  // --- assistant proposals -------------------------------------------------

  async createProposal(input: {
    accountId?: string;
    providerThreadId: string;
    actionType: string;
    params?: Record<string, unknown>;
    reason: string;
  }): Promise<MailboxProposal> {
    const accountId = await this.resolveAccountId(input.accountId);
    const now = Date.now();
    return this.deps.store.createProposal({
      id: localId("proposal"),
      accountId,
      providerThreadId: input.providerThreadId,
      actionType: input.actionType,
      params: input.params ?? {},
      source: "assistant",
      reason: input.reason,
      requiresApproval: true,
      status: "proposed",
      display: `${input.actionType} on thread ${input.providerThreadId}`,
      createdAt: now,
      updatedAt: now,
    });
  }

  get store(): MailboxStore {
    return this.deps.store;
  }
}

/** Wire the default production dependencies. */
export function createDefaultMailboxService(
  overrides?: Partial<MailboxServiceDeps>,
): MailboxService {
  const store = overrides?.store ?? getMailboxStore();
  const gmailBridge = overrides?.gmailBridge ?? createGmailBridge();
  const providers =
    overrides?.providers ?? new DefaultMailboxProviderRegistry({ store, gmailBridge });
  const audit = new MailboxAuditLog(store);
  const scheduler = overrides?.scheduler ?? new MailboxScheduledActionScheduler({ store });
  const aiMatcher = overrides?.aiMatcher ?? new LlmAiMatcher();
  const draftGenerator = overrides?.draftGenerator ?? new LlmDraftGenerator({ store });
  const actionRunner =
    overrides?.actionRunner ??
    new MailboxActionRunner({
      store,
      providers,
      audit,
      scheduler,
      hooks: {
        draftReply: async (ctx) => {
          const draft = await ensureSingleDraftSuggestion({
            accountId: ctx.account.id,
            thread: ctx.thread,
            source: "rule",
            store,
            draftGenerator,
          });
          return { draftId: draft.id };
        },
      },
    });
  const ruleEngine =
    overrides?.ruleEngine ??
    new MailboxRuleEngine({ store, aiMatcher, actionRunner, audit, maxThreadAgeDaysForAuto: 30 });
  const replyTracker =
    overrides?.replyTracker ??
    new ReplyTrackerService({ store, classifier: new LlmReplyClassifier() });
  const syncController =
    overrides?.syncController ?? new MailboxSyncController({ store, providers });

  return new MailboxService({
    store,
    providers,
    syncController,
    ruleEngine,
    actionRunner,
    scheduler,
    replyTracker,
    draftGenerator,
    aiMatcher,
    gmailBridge,
  });
}

let singleton: MailboxService | null = null;

/** Lazily-constructed process singleton for IPC and background use. */
export function getMailboxService(): MailboxService {
  if (!singleton) singleton = createDefaultMailboxService();
  return singleton;
}
