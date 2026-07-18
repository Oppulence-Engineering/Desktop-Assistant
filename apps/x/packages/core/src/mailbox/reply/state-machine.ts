/**
 * Reply tracker state machine.
 *
 * Pure transition function: given the current tracker, an event, settings, and a
 * clock, produce the next tracker state. Keeping this pure makes the whole
 * Needs-Reply / Awaiting-Reply lifecycle testable with fake timers and
 * guarantees transitions are idempotent — re-applying the same event yields the
 * same state.
 */

import type { MailboxMessage } from "../types.js";
import type { MailboxThreadTracker, ReplyClassification, ReplyZeroSettings } from "./types.js";

export type ReplyTrackerEvent =
  | { type: "inbound_message"; message: MailboxMessage; classification: ReplyClassification }
  | { type: "outbound_message"; message: MailboxMessage; expectsReply: boolean }
  | { type: "user_mark_done" }
  | { type: "user_mark_awaiting"; dueInDays?: number }
  | { type: "user_mark_needs_action"; reason?: string }
  | { type: "nudge_sent"; draftId: string };

export type TransitionInput = {
  current: MailboxThreadTracker;
  event: ReplyTrackerEvent;
  settings: ReplyZeroSettings;
  now: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Returns the tracker fields to persist after applying the event. */
export function transitionTracker(input: TransitionInput): MailboxThreadTracker {
  const { current, event, settings, now } = input;
  const base: MailboxThreadTracker = { ...current, updatedAt: now };

  switch (event.type) {
    case "inbound_message": {
      const { classification, message } = event;
      if (classification.status === "needs_reply") {
        return {
          ...base,
          status: "needs_reply",
          lastInboundMessageId: message.id,
          dueAt: now + settings.needsReplyDays * DAY_MS,
          reason: classification.reason,
          confidence: classification.confidence,
        };
      }
      if (classification.status === "needs_action") {
        return {
          ...base,
          status: "needs_action",
          lastInboundMessageId: message.id,
          reason: classification.reason,
          confidence: classification.confidence,
          dueAt: undefined,
        };
      }
      return {
        ...base,
        status: "done",
        lastInboundMessageId: message.id,
        reason: classification.reason ?? "No reply required",
        dueAt: undefined,
      };
    }

    case "outbound_message":
      return {
        ...base,
        status: event.expectsReply ? "awaiting_reply" : "done",
        lastOutboundMessageId: event.message.id,
        // A fresh outbound message clears any pending follow-up nudge marker.
        followUpAppliedAt: undefined,
        followUpDraftId: undefined,
        dueAt: event.expectsReply ? now + settings.awaitingReplyDays * DAY_MS : undefined,
        reason: event.expectsReply
          ? "Outbound message appears to expect a response"
          : "Outbound reply resolved the thread",
      };

    case "user_mark_done":
      return { ...base, status: "done", dueAt: undefined, reason: "Marked done" };

    case "user_mark_awaiting":
      return {
        ...base,
        status: "awaiting_reply",
        dueAt: now + (event.dueInDays ?? settings.awaitingReplyDays) * DAY_MS,
        reason: "Marked awaiting reply",
      };

    case "user_mark_needs_action":
      return { ...base, status: "needs_action", reason: event.reason ?? "Marked needs action" };

    case "nudge_sent":
      return {
        ...base,
        followUpAppliedAt: now,
        followUpDraftId: event.draftId,
        reason: `Follow-up nudge drafted (${event.draftId})`,
      };
  }
}

/**
 * Whether an awaiting-reply thread is due for a follow-up nudge: the due date
 * has passed, the recipient has not replied since, and no nudge is already out.
 */
export function shouldCreateNudge(tracker: MailboxThreadTracker, now: number): boolean {
  return (
    tracker.status === "awaiting_reply" &&
    tracker.dueAt !== undefined &&
    tracker.dueAt <= now &&
    tracker.followUpAppliedAt === undefined
  );
}
