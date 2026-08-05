/**
 * Local mailbox store.
 *
 * The store owns product/automation state: accounts, sync health, rules, audit
 * records, scheduled actions, reply trackers, draft suggestions, learned
 * memories, sender profiles, categories, and assistant proposals. Full message
 * bodies stay in the provider's existing on-disk cache and are hydrated on
 * demand; the store keeps lightweight thread summaries so queues and offline
 * listing work without a provider round trip.
 *
 * {@link InMemoryMailboxStore} is the reference implementation used by tests and
 * as the model backing the persistent FS store.
 */

import type {
  MailboxAccount,
  MailboxErrorShape,
  MailboxParticipant,
  MailboxProviderKind,
  MailboxQueue,
  MailboxThreadPage,
  MailboxThreadSummary,
} from "./types.js";
import type {
  MailboxActionRun,
  MailboxDigestItem,
  MailboxLearnedPattern,
  MailboxRule,
  MailboxRuleRun,
  MailboxScheduledAction,
} from "./rules/types.js";
import type {
  MailboxDraftSuggestion,
  MailboxReplyMemory,
  MailboxThreadTracker,
  ReplyTrackerStatus,
} from "./reply/types.js";

export type MailboxSyncMode =
  | "idle"
  | "backfill"
  | "incremental"
  | "backoff"
  | "needs_reconnect"
  | "paused";

export type MailboxSyncState = {
  accountId: string;
  mode: MailboxSyncMode;
  lastCursor?: string;
  cursorHealth: "healthy" | "invalid" | "unknown";
  lastSuccessfulSyncAt?: number;
  lastAttemptAt?: number;
  nextAttemptAt?: number;
  consecutiveFailures: number;
  lastError?: MailboxErrorShape;
  updatedAt: number;
};

export type MailboxSenderProfile = {
  accountId: string;
  email: string;
  domain: string;
  displayName?: string;
  messageCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  /** True once the user has ever sent to or replied to this sender. */
  hasPriorContact: boolean;
  categoryId?: string;
  isNewsletter: boolean;
  isColdEmail: boolean;
  unsubscribeUrl?: string;
  /**
   * Deterministically parsed from the sender's own signature block.
   *
   * Local only. `phone` in particular is never published as relationship evidence:
   * it is PII with no relationship dimension to land in, and this record is the
   * reason it does not need one.
   */
  signature?: {
    title?: string;
    organization?: string;
    phone?: string;
    confidence: number;
    /** Distinct threads the same claim has appeared in. Repetition is the only
     *  corroboration available without a vendor. */
    seenInThreads: number;
    updatedAt: number;
  };
  /** Last time this sender appeared in published relationship evidence. */
  lastPublishedAt?: number;
};

export type MailboxCategory = {
  id: string;
  accountId: string;
  name: string;
  system: boolean;
  description?: string;
  createdAt: number;
};

export type MailboxProposalStatus = "proposed" | "approved" | "executed" | "rejected" | "expired";

export type MailboxProposal = {
  id: string;
  accountId: string;
  providerThreadId: string;
  actionType: string;
  params: Record<string, unknown>;
  source: "assistant" | "rule" | "manual";
  reason: string;
  requiresApproval: boolean;
  status: MailboxProposalStatus;
  display: string;
  createdAt: number;
  updatedAt: number;
};

export type MailboxLocalThreadQuery = {
  accountId?: string;
  queue?: MailboxQueue;
  limit?: number;
  cursor?: string;
};

export type CreateRuleRunInput = Omit<MailboxRuleRun, "id" | "createdAt"> & {
  id?: string;
  createdAt?: number;
};

export type CreateActionRunInput = Omit<MailboxActionRun, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

export interface MailboxStore {
  // accounts
  upsertAccount(account: MailboxAccount): Promise<void>;
  getAccount(accountId: string): Promise<MailboxAccount | null>;
  getDefaultAccount(filter?: { provider?: MailboxProviderKind }): Promise<MailboxAccount | null>;
  listAccounts(): Promise<MailboxAccount[]>;
  deleteAccount(accountId: string): Promise<void>;

  // sync state
  getSyncState(accountId: string): Promise<MailboxSyncState | null>;
  updateSyncState(accountId: string, patch: Partial<MailboxSyncState>): Promise<MailboxSyncState>;

  // thread summary cache
  upsertThreadSummary(summary: MailboxThreadSummary): Promise<void>;
  getThreadSummary(
    accountId: string,
    providerThreadId: string,
  ): Promise<MailboxThreadSummary | null>;
  removeThreadSummary(accountId: string, providerThreadId: string): Promise<void>;
  listThreadSummaries(query: MailboxLocalThreadQuery): Promise<MailboxThreadPage>;

  // rules
  createRule(rule: MailboxRule): Promise<MailboxRule>;
  updateRule(id: string, patch: Partial<MailboxRule>): Promise<MailboxRule>;
  getRule(id: string): Promise<MailboxRule | null>;
  listRules(accountId: string): Promise<MailboxRule[]>;
  listEnabledRules(accountId: string): Promise<MailboxRule[]>;
  deleteRule(id: string): Promise<void>;

  // learned patterns
  upsertLearnedPattern(pattern: MailboxLearnedPattern): Promise<void>;
  listLearnedPatterns(accountId: string, ruleId?: string): Promise<MailboxLearnedPattern[]>;

  // rule runs (audit)
  createRuleRun(input: CreateRuleRunInput): Promise<MailboxRuleRun>;
  getRuleRunByDedupeKey(dedupeKey: string): Promise<MailboxRuleRun | null>;
  listRuleRuns(accountId: string, opts?: { limit?: number }): Promise<MailboxRuleRun[]>;

  // action runs (audit)
  createActionRun(input: CreateActionRunInput): Promise<MailboxActionRun>;
  updateActionRun(id: string, patch: Partial<MailboxActionRun>): Promise<MailboxActionRun>;
  getActionRunByDedupeKey(dedupeKey: string): Promise<MailboxActionRun | null>;
  listActionRuns(accountId: string, opts?: { limit?: number }): Promise<MailboxActionRun[]>;

  // scheduled actions
  createScheduledAction(action: MailboxScheduledAction): Promise<MailboxScheduledAction>;
  updateScheduledAction(
    id: string,
    patch: Partial<MailboxScheduledAction>,
  ): Promise<MailboxScheduledAction>;
  getScheduledActionByDedupeKey(dedupeKey: string): Promise<MailboxScheduledAction | null>;
  listDueScheduledActions(now: number): Promise<MailboxScheduledAction[]>;
  cancelScheduledActionsForThread(
    accountId: string,
    providerThreadId: string,
    reason: string,
  ): Promise<number>;

  // digest queue
  enqueueDigestItem(item: MailboxDigestItem): Promise<void>;
  listPendingDigestItems(accountId: string): Promise<MailboxDigestItem[]>;
  markDigestItemsDelivered(ids: string[], deliveredAt: number): Promise<void>;

  // reply trackers
  upsertTracker(tracker: MailboxThreadTracker): Promise<void>;
  getTrackerByThread(accountId: string, threadId: string): Promise<MailboxThreadTracker | null>;
  listTrackers(
    accountId: string,
    filter?: { status?: ReplyTrackerStatus },
  ): Promise<MailboxThreadTracker[]>;

  // draft suggestions
  createDraftSuggestion(draft: MailboxDraftSuggestion): Promise<MailboxDraftSuggestion>;
  updateDraftSuggestion(
    id: string,
    patch: Partial<MailboxDraftSuggestion>,
  ): Promise<MailboxDraftSuggestion>;
  getDraftSuggestion(id: string): Promise<MailboxDraftSuggestion | null>;
  findOpenDraftSuggestion(input: {
    accountId: string;
    threadId: string;
    source: string;
  }): Promise<MailboxDraftSuggestion | null>;
  listDraftSuggestions(accountId: string): Promise<MailboxDraftSuggestion[]>;

  // reply memories
  upsertReplyMemory(memory: MailboxReplyMemory): Promise<void>;
  listReplyMemories(accountId: string): Promise<MailboxReplyMemory[]>;
  deleteReplyMemory(id: string): Promise<void>;

  // sender profiles
  upsertSenderProfile(profile: MailboxSenderProfile): Promise<void>;
  getSenderProfile(accountId: string, email: string): Promise<MailboxSenderProfile | null>;
  listSenderProfiles(accountId: string): Promise<MailboxSenderProfile[]>;

  // categories
  upsertCategory(category: MailboxCategory): Promise<void>;
  listCategories(accountId: string): Promise<MailboxCategory[]>;

  // assistant proposals
  createProposal(proposal: MailboxProposal): Promise<MailboxProposal>;
  updateProposal(id: string, patch: Partial<MailboxProposal>): Promise<MailboxProposal>;
  getProposal(id: string): Promise<MailboxProposal | null>;
  listProposals(accountId: string): Promise<MailboxProposal[]>;

  /** Snapshot of everything, for the persistence layer and debug export. */
  exportState(): MailboxStoreState;
  importState(state: MailboxStoreState): void;
}

/** Serializable snapshot of the whole store. */
export type MailboxStoreState = {
  version: number;
  accounts: MailboxAccount[];
  syncState: MailboxSyncState[];
  threadSummaries: MailboxThreadSummary[];
  rules: MailboxRule[];
  learnedPatterns: MailboxLearnedPattern[];
  ruleRuns: MailboxRuleRun[];
  actionRuns: MailboxActionRun[];
  scheduledActions: MailboxScheduledAction[];
  digestItems: MailboxDigestItem[];
  trackers: MailboxThreadTracker[];
  draftSuggestions: MailboxDraftSuggestion[];
  replyMemories: MailboxReplyMemory[];
  senderProfiles: MailboxSenderProfile[];
  categories: MailboxCategory[];
  proposals: MailboxProposal[];
};

export const MAILBOX_STORE_VERSION = 1;

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Which product queue a thread summary belongs to, used for local filtering. */
function threadMatchesQueue(summary: MailboxThreadSummary, queue: MailboxQueue): boolean {
  switch (queue) {
    case "important":
      return summary.categories.includes("important");
    case "other":
      return !summary.categories.includes("important");
    case "unread":
      return summary.unread;
    case "needs_reply":
    case "awaiting_reply":
    case "needs_action":
    case "newsletter":
    case "cold_email":
      return summary.categories.includes(queue);
    case "attachments":
      return summary.categories.includes("attachments");
    default:
      return true;
  }
}

/** Opaque "<latestMessageAt>|<threadId>" cursor, newest-first pagination. */
function encodeCursor(summary: MailboxThreadSummary): string {
  return `${summary.latestMessageAt}|${summary.id}`;
}

function compareNewestFirst(a: MailboxThreadSummary, b: MailboxThreadSummary): number {
  if (a.latestMessageAt !== b.latestMessageAt) return b.latestMessageAt - a.latestMessageAt;
  return a.id < b.id ? 1 : -1;
}

export class InMemoryMailboxStore implements MailboxStore {
  private accounts = new Map<string, MailboxAccount>();
  private syncState = new Map<string, MailboxSyncState>();
  private threadSummaries = new Map<string, MailboxThreadSummary>();
  private rules = new Map<string, MailboxRule>();
  private learnedPatterns = new Map<string, MailboxLearnedPattern>();
  private ruleRuns = new Map<string, MailboxRuleRun>();
  private ruleRunsByDedupe = new Map<string, string>();
  private actionRuns = new Map<string, MailboxActionRun>();
  private actionRunsByDedupe = new Map<string, string>();
  private scheduledActions = new Map<string, MailboxScheduledAction>();
  private digestItems = new Map<string, MailboxDigestItem>();
  private trackers = new Map<string, MailboxThreadTracker>();
  private draftSuggestions = new Map<string, MailboxDraftSuggestion>();
  private replyMemories = new Map<string, MailboxReplyMemory>();
  private senderProfiles = new Map<string, MailboxSenderProfile>();
  private categories = new Map<string, MailboxCategory>();
  private proposals = new Map<string, MailboxProposal>();

  private seq = 0;

  /** Notified after every mutation so the FS layer can persist. */
  onChange?: () => void;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq.toString(36)}`;
  }

  private touched(): void {
    this.onChange?.();
  }

  private threadKey(accountId: string, providerThreadId: string): string {
    return `${accountId}::${providerThreadId}`;
  }

  private senderKey(accountId: string, email: string): string {
    return `${accountId}::${email.toLowerCase()}`;
  }

  // accounts ----------------------------------------------------------------

  async upsertAccount(account: MailboxAccount): Promise<void> {
    this.accounts.set(account.id, clone(account));
    this.touched();
  }

  async getAccount(accountId: string): Promise<MailboxAccount | null> {
    const found = this.accounts.get(accountId);
    return found ? clone(found) : null;
  }

  async getDefaultAccount(filter?: {
    provider?: MailboxProviderKind;
  }): Promise<MailboxAccount | null> {
    for (const account of this.accounts.values()) {
      if (!filter?.provider || account.provider === filter.provider) return clone(account);
    }
    return null;
  }

  async listAccounts(): Promise<MailboxAccount[]> {
    return [...this.accounts.values()].map(clone);
  }

  async deleteAccount(accountId: string): Promise<void> {
    this.accounts.delete(accountId);
    this.syncState.delete(accountId);
    this.touched();
  }

  // sync state --------------------------------------------------------------

  async getSyncState(accountId: string): Promise<MailboxSyncState | null> {
    const found = this.syncState.get(accountId);
    return found ? clone(found) : null;
  }

  async updateSyncState(
    accountId: string,
    patch: Partial<MailboxSyncState>,
  ): Promise<MailboxSyncState> {
    const current: MailboxSyncState =
      this.syncState.get(accountId) ??
      ({
        accountId,
        mode: "idle",
        cursorHealth: "unknown",
        consecutiveFailures: 0,
        updatedAt: Date.now(),
      } satisfies MailboxSyncState);
    const next: MailboxSyncState = { ...current, ...patch, accountId, updatedAt: Date.now() };
    this.syncState.set(accountId, next);
    this.touched();
    return clone(next);
  }

  // thread summary cache ----------------------------------------------------

  async upsertThreadSummary(summary: MailboxThreadSummary): Promise<void> {
    this.threadSummaries.set(
      this.threadKey(summary.accountId, summary.providerThreadId),
      clone(summary),
    );
    this.touched();
  }

  async getThreadSummary(
    accountId: string,
    providerThreadId: string,
  ): Promise<MailboxThreadSummary | null> {
    const found = this.threadSummaries.get(this.threadKey(accountId, providerThreadId));
    return found ? clone(found) : null;
  }

  async removeThreadSummary(accountId: string, providerThreadId: string): Promise<void> {
    this.threadSummaries.delete(this.threadKey(accountId, providerThreadId));
    this.touched();
  }

  async listThreadSummaries(query: MailboxLocalThreadQuery): Promise<MailboxThreadPage> {
    let items = [...this.threadSummaries.values()];
    if (query.accountId) items = items.filter((t) => t.accountId === query.accountId);
    if (query.queue) items = items.filter((t) => threadMatchesQueue(t, query.queue!));
    items.sort(compareNewestFirst);

    if (query.cursor) {
      const [rawAt, rawId] = query.cursor.split("|");
      const cursorAt = Number(rawAt);
      items = items.filter((t) => {
        if (t.latestMessageAt !== cursorAt) return t.latestMessageAt < cursorAt;
        return t.id < rawId;
      });
    }

    const limit = query.limit ?? 50;
    const page = items.slice(0, limit);
    const nextCursor = items.length > limit ? encodeCursor(page[page.length - 1]) : undefined;
    return { threads: page.map(clone), nextCursor };
  }

  // rules -------------------------------------------------------------------

  async createRule(rule: MailboxRule): Promise<MailboxRule> {
    const withId: MailboxRule = { ...rule, id: rule.id || this.id("rule") };
    this.rules.set(withId.id, clone(withId));
    this.touched();
    return clone(withId);
  }

  async updateRule(id: string, patch: Partial<MailboxRule>): Promise<MailboxRule> {
    const current = this.rules.get(id);
    if (!current) throw new Error(`Rule not found: ${id}`);
    const next: MailboxRule = { ...current, ...patch, id, updatedAt: Date.now() };
    this.rules.set(id, next);
    this.touched();
    return clone(next);
  }

  async getRule(id: string): Promise<MailboxRule | null> {
    const found = this.rules.get(id);
    return found ? clone(found) : null;
  }

  async listRules(accountId: string): Promise<MailboxRule[]> {
    return [...this.rules.values()].filter((r) => r.accountId === accountId).map(clone);
  }

  async listEnabledRules(accountId: string): Promise<MailboxRule[]> {
    return [...this.rules.values()]
      .filter((r) => r.accountId === accountId && r.enabled)
      .map(clone);
  }

  async deleteRule(id: string): Promise<void> {
    this.rules.delete(id);
    this.touched();
  }

  // learned patterns --------------------------------------------------------

  async upsertLearnedPattern(pattern: MailboxLearnedPattern): Promise<void> {
    this.learnedPatterns.set(pattern.id, clone(pattern));
    this.touched();
  }

  async listLearnedPatterns(accountId: string, ruleId?: string): Promise<MailboxLearnedPattern[]> {
    return [...this.learnedPatterns.values()]
      .filter((p) => p.accountId === accountId && (!ruleId || p.ruleId === ruleId))
      .map(clone);
  }

  // rule runs ---------------------------------------------------------------

  async createRuleRun(input: CreateRuleRunInput): Promise<MailboxRuleRun> {
    const run: MailboxRuleRun = {
      ...input,
      id: input.id ?? this.id("rulerun"),
      createdAt: input.createdAt ?? Date.now(),
    };
    this.ruleRuns.set(run.id, clone(run));
    this.ruleRunsByDedupe.set(run.dedupeKey, run.id);
    this.touched();
    return clone(run);
  }

  async getRuleRunByDedupeKey(dedupeKey: string): Promise<MailboxRuleRun | null> {
    const id = this.ruleRunsByDedupe.get(dedupeKey);
    if (!id) return null;
    const found = this.ruleRuns.get(id);
    return found ? clone(found) : null;
  }

  async listRuleRuns(accountId: string, opts?: { limit?: number }): Promise<MailboxRuleRun[]> {
    const items = [...this.ruleRuns.values()]
      .filter((r) => r.accountId === accountId)
      .sort((a, b) => b.createdAt - a.createdAt);
    return (opts?.limit ? items.slice(0, opts.limit) : items).map(clone);
  }

  // action runs -------------------------------------------------------------

  async createActionRun(input: CreateActionRunInput): Promise<MailboxActionRun> {
    const now = Date.now();
    const run: MailboxActionRun = {
      ...input,
      id: input.id ?? this.id("actionrun"),
      createdAt: now,
      updatedAt: now,
    };
    this.actionRuns.set(run.id, clone(run));
    this.actionRunsByDedupe.set(run.dedupeKey, run.id);
    this.touched();
    return clone(run);
  }

  async updateActionRun(id: string, patch: Partial<MailboxActionRun>): Promise<MailboxActionRun> {
    const current = this.actionRuns.get(id);
    if (!current) throw new Error(`Action run not found: ${id}`);
    const next: MailboxActionRun = { ...current, ...patch, id, updatedAt: Date.now() };
    this.actionRuns.set(id, next);
    if (next.dedupeKey) this.actionRunsByDedupe.set(next.dedupeKey, id);
    this.touched();
    return clone(next);
  }

  async getActionRunByDedupeKey(dedupeKey: string): Promise<MailboxActionRun | null> {
    const id = this.actionRunsByDedupe.get(dedupeKey);
    if (!id) return null;
    const found = this.actionRuns.get(id);
    return found ? clone(found) : null;
  }

  async listActionRuns(accountId: string, opts?: { limit?: number }): Promise<MailboxActionRun[]> {
    const items = [...this.actionRuns.values()]
      .filter((r) => r.accountId === accountId)
      .sort((a, b) => b.createdAt - a.createdAt);
    return (opts?.limit ? items.slice(0, opts.limit) : items).map(clone);
  }

  // scheduled actions -------------------------------------------------------

  async createScheduledAction(action: MailboxScheduledAction): Promise<MailboxScheduledAction> {
    this.scheduledActions.set(action.id, clone(action));
    this.touched();
    return clone(action);
  }

  async updateScheduledAction(
    id: string,
    patch: Partial<MailboxScheduledAction>,
  ): Promise<MailboxScheduledAction> {
    const current = this.scheduledActions.get(id);
    if (!current) throw new Error(`Scheduled action not found: ${id}`);
    const next: MailboxScheduledAction = { ...current, ...patch, id, updatedAt: Date.now() };
    this.scheduledActions.set(id, next);
    this.touched();
    return clone(next);
  }

  async getScheduledActionByDedupeKey(dedupeKey: string): Promise<MailboxScheduledAction | null> {
    for (const action of this.scheduledActions.values()) {
      if (action.dedupeKey === dedupeKey) return clone(action);
    }
    return null;
  }

  async listDueScheduledActions(now: number): Promise<MailboxScheduledAction[]> {
    return [...this.scheduledActions.values()]
      .filter((a) => a.status === "scheduled" && a.scheduledFor <= now)
      .sort((a, b) => a.scheduledFor - b.scheduledFor)
      .map(clone);
  }

  async cancelScheduledActionsForThread(
    accountId: string,
    providerThreadId: string,
    reason: string,
  ): Promise<number> {
    let cancelled = 0;
    for (const action of this.scheduledActions.values()) {
      if (
        action.accountId === accountId &&
        action.providerThreadId === providerThreadId &&
        action.status === "scheduled"
      ) {
        action.status = "cancelled";
        action.cancelReason = reason;
        action.updatedAt = Date.now();
        cancelled += 1;
      }
    }
    if (cancelled > 0) this.touched();
    return cancelled;
  }

  // digest queue ------------------------------------------------------------

  async enqueueDigestItem(item: MailboxDigestItem): Promise<void> {
    this.digestItems.set(item.id, clone(item));
    this.touched();
  }

  async listPendingDigestItems(accountId: string): Promise<MailboxDigestItem[]> {
    return [...this.digestItems.values()]
      .filter((d) => d.accountId === accountId && !d.deliveredAt)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  async markDigestItemsDelivered(ids: string[], deliveredAt: number): Promise<void> {
    for (const id of ids) {
      const item = this.digestItems.get(id);
      if (item) item.deliveredAt = deliveredAt;
    }
    this.touched();
  }

  // trackers ----------------------------------------------------------------

  async upsertTracker(tracker: MailboxThreadTracker): Promise<void> {
    this.trackers.set(this.threadKey(tracker.accountId, tracker.threadId), clone(tracker));
    this.touched();
  }

  async getTrackerByThread(
    accountId: string,
    threadId: string,
  ): Promise<MailboxThreadTracker | null> {
    const found = this.trackers.get(this.threadKey(accountId, threadId));
    return found ? clone(found) : null;
  }

  async listTrackers(
    accountId: string,
    filter?: { status?: ReplyTrackerStatus },
  ): Promise<MailboxThreadTracker[]> {
    return [...this.trackers.values()]
      .filter((t) => t.accountId === accountId && (!filter?.status || t.status === filter.status))
      .sort((a, b) => (b.dueAt ?? b.updatedAt) - (a.dueAt ?? a.updatedAt))
      .map(clone);
  }

  // draft suggestions -------------------------------------------------------

  async createDraftSuggestion(draft: MailboxDraftSuggestion): Promise<MailboxDraftSuggestion> {
    const withId: MailboxDraftSuggestion = { ...draft, id: draft.id || this.id("draft") };
    this.draftSuggestions.set(withId.id, clone(withId));
    this.touched();
    return clone(withId);
  }

  async updateDraftSuggestion(
    id: string,
    patch: Partial<MailboxDraftSuggestion>,
  ): Promise<MailboxDraftSuggestion> {
    const current = this.draftSuggestions.get(id);
    if (!current) throw new Error(`Draft suggestion not found: ${id}`);
    const next: MailboxDraftSuggestion = { ...current, ...patch, id, updatedAt: Date.now() };
    this.draftSuggestions.set(id, next);
    this.touched();
    return clone(next);
  }

  async getDraftSuggestion(id: string): Promise<MailboxDraftSuggestion | null> {
    const found = this.draftSuggestions.get(id);
    return found ? clone(found) : null;
  }

  async findOpenDraftSuggestion(input: {
    accountId: string;
    threadId: string;
    source: string;
  }): Promise<MailboxDraftSuggestion | null> {
    for (const draft of this.draftSuggestions.values()) {
      if (
        draft.accountId === input.accountId &&
        draft.threadId === input.threadId &&
        draft.source === input.source &&
        draft.status !== "sent" &&
        draft.status !== "discarded"
      ) {
        return clone(draft);
      }
    }
    return null;
  }

  async listDraftSuggestions(accountId: string): Promise<MailboxDraftSuggestion[]> {
    return [...this.draftSuggestions.values()]
      .filter((d) => d.accountId === accountId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(clone);
  }

  // reply memories ----------------------------------------------------------

  async upsertReplyMemory(memory: MailboxReplyMemory): Promise<void> {
    this.replyMemories.set(memory.id, clone(memory));
    this.touched();
  }

  async listReplyMemories(accountId: string): Promise<MailboxReplyMemory[]> {
    return [...this.replyMemories.values()].filter((m) => m.accountId === accountId).map(clone);
  }

  async deleteReplyMemory(id: string): Promise<void> {
    this.replyMemories.delete(id);
    this.touched();
  }

  // sender profiles ---------------------------------------------------------

  async upsertSenderProfile(profile: MailboxSenderProfile): Promise<void> {
    this.senderProfiles.set(this.senderKey(profile.accountId, profile.email), clone(profile));
    this.touched();
  }

  async getSenderProfile(accountId: string, email: string): Promise<MailboxSenderProfile | null> {
    const found = this.senderProfiles.get(this.senderKey(accountId, email));
    return found ? clone(found) : null;
  }

  async listSenderProfiles(accountId: string): Promise<MailboxSenderProfile[]> {
    return [...this.senderProfiles.values()].filter((p) => p.accountId === accountId).map(clone);
  }

  // categories --------------------------------------------------------------

  async upsertCategory(category: MailboxCategory): Promise<void> {
    this.categories.set(category.id, clone(category));
    this.touched();
  }

  async listCategories(accountId: string): Promise<MailboxCategory[]> {
    return [...this.categories.values()].filter((c) => c.accountId === accountId).map(clone);
  }

  // proposals ---------------------------------------------------------------

  async createProposal(proposal: MailboxProposal): Promise<MailboxProposal> {
    const withId: MailboxProposal = { ...proposal, id: proposal.id || this.id("proposal") };
    this.proposals.set(withId.id, clone(withId));
    this.touched();
    return clone(withId);
  }

  async updateProposal(id: string, patch: Partial<MailboxProposal>): Promise<MailboxProposal> {
    const current = this.proposals.get(id);
    if (!current) throw new Error(`Proposal not found: ${id}`);
    const next: MailboxProposal = { ...current, ...patch, id, updatedAt: Date.now() };
    this.proposals.set(id, next);
    this.touched();
    return clone(next);
  }

  async getProposal(id: string): Promise<MailboxProposal | null> {
    const found = this.proposals.get(id);
    return found ? clone(found) : null;
  }

  async listProposals(accountId: string): Promise<MailboxProposal[]> {
    return [...this.proposals.values()]
      .filter((p) => p.accountId === accountId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(clone);
  }

  // snapshot ----------------------------------------------------------------

  exportState(): MailboxStoreState {
    return clone({
      version: MAILBOX_STORE_VERSION,
      accounts: [...this.accounts.values()],
      syncState: [...this.syncState.values()],
      threadSummaries: [...this.threadSummaries.values()],
      rules: [...this.rules.values()],
      learnedPatterns: [...this.learnedPatterns.values()],
      ruleRuns: [...this.ruleRuns.values()],
      actionRuns: [...this.actionRuns.values()],
      scheduledActions: [...this.scheduledActions.values()],
      digestItems: [...this.digestItems.values()],
      trackers: [...this.trackers.values()],
      draftSuggestions: [...this.draftSuggestions.values()],
      replyMemories: [...this.replyMemories.values()],
      senderProfiles: [...this.senderProfiles.values()],
      categories: [...this.categories.values()],
      proposals: [...this.proposals.values()],
    });
  }

  importState(state: MailboxStoreState): void {
    this.accounts = new Map(state.accounts.map((a) => [a.id, a]));
    this.syncState = new Map(state.syncState.map((s) => [s.accountId, s]));
    this.threadSummaries = new Map(
      state.threadSummaries.map((t) => [this.threadKey(t.accountId, t.providerThreadId), t]),
    );
    this.rules = new Map(state.rules.map((r) => [r.id, r]));
    this.learnedPatterns = new Map(state.learnedPatterns.map((p) => [p.id, p]));
    this.ruleRuns = new Map(state.ruleRuns.map((r) => [r.id, r]));
    this.ruleRunsByDedupe = new Map(state.ruleRuns.map((r) => [r.dedupeKey, r.id]));
    this.actionRuns = new Map(state.actionRuns.map((r) => [r.id, r]));
    this.actionRunsByDedupe = new Map(state.actionRuns.map((r) => [r.dedupeKey, r.id]));
    this.scheduledActions = new Map(state.scheduledActions.map((a) => [a.id, a]));
    this.digestItems = new Map(state.digestItems.map((d) => [d.id, d]));
    this.trackers = new Map(
      state.trackers.map((t) => [this.threadKey(t.accountId, t.threadId), t]),
    );
    this.draftSuggestions = new Map(state.draftSuggestions.map((d) => [d.id, d]));
    this.replyMemories = new Map(state.replyMemories.map((m) => [m.id, m]));
    this.senderProfiles = new Map(
      state.senderProfiles.map((p) => [this.senderKey(p.accountId, p.email), p]),
    );
    this.categories = new Map(state.categories.map((c) => [c.id, c]));
    this.proposals = new Map(state.proposals.map((p) => [p.id, p]));
  }
}

/** Convenience for referencing a participant list textually in logs/UI (no emails leaked in logs). */
export function participantSummary(participants: MailboxParticipant[]): string {
  return participants.map((p) => p.name ?? p.email.split("@")[0]).join(", ");
}
