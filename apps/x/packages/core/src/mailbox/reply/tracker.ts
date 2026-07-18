/**
 * Reply tracker service.
 *
 * Drives thread trackers through the pure state machine and persists them.
 * Processes inbound/outbound messages from sync, exposes user actions (mark
 * done/awaiting/needs-action), and finds awaiting threads that are due for a
 * follow-up nudge. Provider outbound messages clear pending nudges here so a
 * fresh reply never gets a stale "just checking in" behind it.
 */

import { localId } from "../ids.js";
import type { MailboxStore } from "../store.js";
import type { MailboxMessage, MailboxThread } from "../types.js";
import { shouldCreateNudge, transitionTracker, type ReplyTrackerEvent } from "./state-machine.js";
import {
  DEFAULT_REPLY_ZERO_SETTINGS,
  type MailboxThreadTracker,
  type ReplyClassification,
  type ReplyZeroSettings,
} from "./types.js";

/** Classifies an inbound message into a tracker status. */
export interface ReplyClassifier {
  classifyInbound(input: {
    thread: MailboxThread;
    message: MailboxMessage;
  }): Promise<ReplyClassification>;

  /** Whether an outbound message appears to expect a response. */
  outboundExpectsReply(input: { thread: MailboxThread; message: MailboxMessage }): Promise<boolean>;
}

export type ReplyTrackerServiceDeps = {
  store: MailboxStore;
  classifier: ReplyClassifier;
  settings?: ReplyZeroSettings;
  now?: () => number;
};

export class ReplyTrackerService {
  private readonly settings: ReplyZeroSettings;

  constructor(private readonly deps: ReplyTrackerServiceDeps) {
    this.settings = deps.settings ?? DEFAULT_REPLY_ZERO_SETTINGS;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private async ensureTracker(
    accountId: string,
    thread: MailboxThread,
  ): Promise<MailboxThreadTracker> {
    const existing = await this.deps.store.getTrackerByThread(accountId, thread.id);
    if (existing) return existing;
    const now = this.now();
    const created: MailboxThreadTracker = {
      id: localId("tracker"),
      accountId,
      threadId: thread.id,
      providerThreadId: thread.providerThreadId,
      status: "done",
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.store.upsertTracker(created);
    return created;
  }

  private async apply(
    tracker: MailboxThreadTracker,
    event: ReplyTrackerEvent,
  ): Promise<MailboxThreadTracker> {
    const next = transitionTracker({
      current: tracker,
      event,
      settings: this.settings,
      now: this.now(),
    });
    await this.deps.store.upsertTracker(next);
    return next;
  }

  /**
   * Processes a thread's latest message from sync, classifying it as inbound or
   * outbound and advancing the tracker. Idempotent: the same message id does not
   * re-transition an unchanged tracker.
   */
  async processThread(accountId: string, thread: MailboxThread): Promise<MailboxThreadTracker> {
    const tracker = await this.ensureTracker(accountId, thread);
    const latest = thread.messages.at(-1);
    if (!latest) return tracker;

    if (latest.isOutbound) {
      if (tracker.lastOutboundMessageId === latest.id) return tracker;
      const expectsReply = await this.deps.classifier.outboundExpectsReply({
        thread,
        message: latest,
      });
      return this.apply(tracker, { type: "outbound_message", message: latest, expectsReply });
    }

    if (tracker.lastInboundMessageId === latest.id) return tracker;
    const classification = await this.deps.classifier.classifyInbound({ thread, message: latest });
    return this.apply(tracker, { type: "inbound_message", message: latest, classification });
  }

  async markDone(accountId: string, threadId: string): Promise<MailboxThreadTracker | null> {
    const tracker = await this.deps.store.getTrackerByThread(accountId, threadId);
    if (!tracker) return null;
    return this.apply(tracker, { type: "user_mark_done" });
  }

  async markAwaiting(
    accountId: string,
    threadId: string,
    dueInDays?: number,
  ): Promise<MailboxThreadTracker | null> {
    const tracker = await this.deps.store.getTrackerByThread(accountId, threadId);
    if (!tracker) return null;
    return this.apply(tracker, { type: "user_mark_awaiting", dueInDays });
  }

  async markNeedsAction(
    accountId: string,
    threadId: string,
    reason?: string,
  ): Promise<MailboxThreadTracker | null> {
    const tracker = await this.deps.store.getTrackerByThread(accountId, threadId);
    if (!tracker) return null;
    return this.apply(tracker, { type: "user_mark_needs_action", reason });
  }

  async recordNudge(
    accountId: string,
    threadId: string,
    draftId: string,
  ): Promise<MailboxThreadTracker | null> {
    const tracker = await this.deps.store.getTrackerByThread(accountId, threadId);
    if (!tracker) return null;
    return this.apply(tracker, { type: "nudge_sent", draftId });
  }

  /** Awaiting-reply trackers whose follow-up is due and have no nudge yet. */
  async listDueForNudge(accountId: string): Promise<MailboxThreadTracker[]> {
    const now = this.now();
    const awaiting = await this.deps.store.listTrackers(accountId, { status: "awaiting_reply" });
    return awaiting.filter((tracker) => shouldCreateNudge(tracker, now));
  }
}
