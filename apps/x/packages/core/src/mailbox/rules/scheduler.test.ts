import { describe, expect, it } from "vitest";

import { InMemoryMailboxStore } from "../store.js";
import { MailboxScheduledActionScheduler, type ScheduledActionExecutor } from "./scheduler.js";
import type { MailboxScheduledAction } from "./types.js";

function fixedNow(ms: number) {
  return () => ms;
}

describe("MailboxScheduledActionScheduler", () => {
  it("schedules a delayed action and dedupes repeat scheduling", async () => {
    const store = new InMemoryMailboxStore();
    const scheduler = new MailboxScheduledActionScheduler({ store, now: fixedNow(0) });

    const input = {
      accountId: "acct_test",
      action: { id: "a1", type: "archive" as const },
      delayMinutes: 10,
      threadId: "thr_1",
      providerThreadId: "t1",
      messageId: "m1",
    };
    const first = await scheduler.scheduleDelayedAction(input);
    const second = await scheduler.scheduleDelayedAction(input);

    expect(first.scheduledFor).toBe(10 * 60_000);
    expect(second.id).toBe(first.id); // deduped, not a second timer
  });

  it("executes due actions and marks them executed", async () => {
    const store = new InMemoryMailboxStore();
    const scheduler = new MailboxScheduledActionScheduler({ store, now: fixedNow(0) });
    await scheduler.scheduleDelayedAction({
      accountId: "acct_test",
      action: { id: "a1", type: "archive" },
      delayMinutes: 1,
      threadId: "thr_1",
      providerThreadId: "t1",
    });

    const executed: MailboxScheduledAction[] = [];
    const executor: ScheduledActionExecutor = {
      async executeScheduled(scheduled) {
        executed.push(scheduled);
      },
    };

    // Not due yet.
    await scheduler.runDue(executor, 30_000);
    expect(executed).toHaveLength(0);

    // Due now.
    const processed = await scheduler.runDue(executor, 120_000);
    expect(executed).toHaveLength(1);
    expect(processed[0].status).toBe("executed");
  });

  it("records a failed status when the executor throws", async () => {
    const store = new InMemoryMailboxStore();
    const scheduler = new MailboxScheduledActionScheduler({ store, now: fixedNow(0) });
    await scheduler.scheduleDelayedAction({
      accountId: "acct_test",
      action: { id: "a1", type: "archive" },
      delayMinutes: 0,
      threadId: "thr_1",
      providerThreadId: "t1",
    });

    const processed = await scheduler.runDue(
      {
        async executeScheduled() {
          throw new Error("boom");
        },
      },
      60_000,
    );
    expect(processed[0].status).toBe("failed");
  });

  it("cancels scheduled actions for a thread", async () => {
    const store = new InMemoryMailboxStore();
    const scheduler = new MailboxScheduledActionScheduler({ store, now: fixedNow(0) });
    await scheduler.scheduleDelayedAction({
      accountId: "acct_test",
      action: { id: "a1", type: "archive" },
      delayMinutes: 5,
      threadId: "thr_1",
      providerThreadId: "t1",
    });

    expect(await scheduler.cancelForThread("acct_test", "t1", "replied")).toBe(1);
    expect(await store.listDueScheduledActions(10 * 60_000)).toHaveLength(0);
  });
});
