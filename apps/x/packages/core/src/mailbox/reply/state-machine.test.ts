import { describe, expect, it } from "vitest";

import { shouldCreateNudge, transitionTracker } from "./state-machine.js";
import { DEFAULT_REPLY_ZERO_SETTINGS, type MailboxThreadTracker } from "./types.js";
import { makeMessage } from "../factories.testkit.js";

const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function baseTracker(overrides: Partial<MailboxThreadTracker> = {}): MailboxThreadTracker {
  return {
    id: "tr1",
    accountId: "acct_test",
    threadId: "thr_1",
    providerThreadId: "t1",
    status: "done",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("transitionTracker", () => {
  it("moves to needs_reply with a due date on a needs_reply inbound", () => {
    const next = transitionTracker({
      current: baseTracker(),
      event: {
        type: "inbound_message",
        message: makeMessage(),
        classification: { status: "needs_reply", reason: "asked a question" },
      },
      settings: DEFAULT_REPLY_ZERO_SETTINGS,
      now: NOW,
    });
    expect(next.status).toBe("needs_reply");
    expect(next.dueAt).toBe(NOW + DEFAULT_REPLY_ZERO_SETTINGS.needsReplyDays * DAY);
  });

  it("moves to awaiting_reply on an outbound that expects a reply", () => {
    const next = transitionTracker({
      current: baseTracker(),
      event: {
        type: "outbound_message",
        message: makeMessage({ isOutbound: true }),
        expectsReply: true,
      },
      settings: DEFAULT_REPLY_ZERO_SETTINGS,
      now: NOW,
    });
    expect(next.status).toBe("awaiting_reply");
    expect(next.dueAt).toBe(NOW + DEFAULT_REPLY_ZERO_SETTINGS.awaitingReplyDays * DAY);
  });

  it("clears a pending nudge marker on a fresh outbound", () => {
    const next = transitionTracker({
      current: baseTracker({ followUpAppliedAt: NOW - DAY, followUpDraftId: "d1" }),
      event: {
        type: "outbound_message",
        message: makeMessage({ isOutbound: true }),
        expectsReply: true,
      },
      settings: DEFAULT_REPLY_ZERO_SETTINGS,
      now: NOW,
    });
    expect(next.followUpAppliedAt).toBeUndefined();
    expect(next.followUpDraftId).toBeUndefined();
  });

  it("resolves to done on a non-reply inbound", () => {
    const next = transitionTracker({
      current: baseTracker({ status: "awaiting_reply" }),
      event: {
        type: "inbound_message",
        message: makeMessage(),
        classification: { status: "done" },
      },
      settings: DEFAULT_REPLY_ZERO_SETTINGS,
      now: NOW,
    });
    expect(next.status).toBe("done");
    expect(next.dueAt).toBeUndefined();
  });

  it("is idempotent when re-applying mark_done", () => {
    const once = transitionTracker({
      current: baseTracker({ status: "needs_reply" }),
      event: { type: "user_mark_done" },
      settings: DEFAULT_REPLY_ZERO_SETTINGS,
      now: NOW,
    });
    const twice = transitionTracker({
      current: once,
      event: { type: "user_mark_done" },
      settings: DEFAULT_REPLY_ZERO_SETTINGS,
      now: NOW,
    });
    expect(twice.status).toBe("done");
    expect(twice).toEqual(once);
  });
});

describe("shouldCreateNudge", () => {
  it("is true only when awaiting, past due, and no nudge yet", () => {
    expect(shouldCreateNudge(baseTracker({ status: "awaiting_reply", dueAt: NOW - 1 }), NOW)).toBe(
      true,
    );
    expect(
      shouldCreateNudge(baseTracker({ status: "awaiting_reply", dueAt: NOW + DAY }), NOW),
    ).toBe(false);
    expect(shouldCreateNudge(baseTracker({ status: "needs_reply", dueAt: NOW - 1 }), NOW)).toBe(
      false,
    );
    expect(
      shouldCreateNudge(
        baseTracker({ status: "awaiting_reply", dueAt: NOW - 1, followUpAppliedAt: NOW - 1 }),
        NOW,
      ),
    ).toBe(false);
  });
});
