import { describe, expect, it } from "vitest";

import { InMemoryMailboxStore } from "./store.js";
import { makeAccount } from "./factories.testkit.js";
import { threadToSummary } from "./normalize.js";
import { makeThread, makeMessage } from "./factories.testkit.js";

function summaryFor(overrides: Parameters<typeof makeThread>[0], categories: string[] = []) {
  const thread = makeThread({ ...overrides, categories });
  return threadToSummary(thread);
}

describe("InMemoryMailboxStore accounts", () => {
  it("upserts and reads accounts, returning clones", async () => {
    const store = new InMemoryMailboxStore();
    const account = makeAccount();
    await store.upsertAccount(account);

    const read = await store.getAccount(account.id);
    expect(read).toEqual(account);
    // Returned object is a clone: mutating it does not affect the store.
    read!.email = "mutated@x.com";
    const reread = await store.getAccount(account.id);
    expect(reread!.email).toBe(account.email);
  });

  it("resolves a default account", async () => {
    const store = new InMemoryMailboxStore();
    await store.upsertAccount(makeAccount());
    expect((await store.getDefaultAccount())?.id).toBe(makeAccount().id);
    expect(await store.getDefaultAccount({ provider: "outlook" })).toBeNull();
  });
});

describe("thread summary cache", () => {
  it("paginates newest-first with an opaque cursor", async () => {
    const store = new InMemoryMailboxStore();
    for (let i = 0; i < 5; i += 1) {
      await store.upsertThreadSummary(
        summaryFor({ providerThreadId: `t${i}`, latestMessageAt: 1000 + i }),
      );
    }
    const page1 = await store.listThreadSummaries({ limit: 2 });
    expect(page1.threads).toHaveLength(2);
    expect(page1.threads[0].latestMessageAt).toBe(1004);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await store.listThreadSummaries({ limit: 2, cursor: page1.nextCursor });
    expect(page2.threads[0].latestMessageAt).toBe(1002);
    // No overlap between pages.
    const ids = new Set(page1.threads.map((t) => t.id));
    expect(page2.threads.every((t) => !ids.has(t.id))).toBe(true);
  });

  it("filters by queue", async () => {
    const store = new InMemoryMailboxStore();
    await store.upsertThreadSummary(summaryFor({ providerThreadId: "imp" }, ["important"]));
    await store.upsertThreadSummary(summaryFor({ providerThreadId: "oth" }, []));

    const important = await store.listThreadSummaries({ queue: "important" });
    expect(important.threads.map((t) => t.providerThreadId)).toEqual(["imp"]);
    const other = await store.listThreadSummaries({ queue: "other" });
    expect(other.threads.map((t) => t.providerThreadId)).toEqual(["oth"]);
  });
});

describe("rule runs dedupe index", () => {
  it("finds a rule run by dedupe key", async () => {
    const store = new InMemoryMailboxStore();
    const run = await store.createRuleRun({
      accountId: "acct_test",
      ruleId: "rule_1",
      ruleVersion: 1,
      dedupeKey: "dk1",
      threadId: "thr_1",
      providerThreadId: "t1",
      status: "matched",
    });
    expect((await store.getRuleRunByDedupeKey("dk1"))?.id).toBe(run.id);
    expect(await store.getRuleRunByDedupeKey("missing")).toBeNull();
  });
});

describe("scheduled actions", () => {
  it("lists only due scheduled actions and cancels per thread", async () => {
    const store = new InMemoryMailboxStore();
    const base = {
      accountId: "acct_test",
      actionId: "a1",
      action: { id: "a1", type: "archive" as const },
      threadId: "thr_1",
      providerThreadId: "t1",
      status: "scheduled" as const,
      createdAt: 0,
      updatedAt: 0,
    };
    await store.createScheduledAction({ ...base, id: "s1", scheduledFor: 100, dedupeKey: "d1" });
    await store.createScheduledAction({ ...base, id: "s2", scheduledFor: 5000, dedupeKey: "d2" });

    expect((await store.listDueScheduledActions(1000)).map((a) => a.id)).toEqual(["s1"]);

    const cancelled = await store.cancelScheduledActionsForThread(
      "acct_test",
      "t1",
      "state changed",
    );
    expect(cancelled).toBe(2);
    expect(await store.listDueScheduledActions(10_000)).toHaveLength(0);
  });
});

describe("export/import", () => {
  it("round-trips full state", async () => {
    const store = new InMemoryMailboxStore();
    await store.upsertAccount(makeAccount());
    await store.upsertThreadSummary(summaryFor({ providerThreadId: "t1" }));
    void makeMessage(); // exercise the factory sequence

    const state = store.exportState();
    const restored = new InMemoryMailboxStore();
    restored.importState(state);

    expect((await restored.getAccount(makeAccount().id))?.email).toBe(makeAccount().email);
    expect((await restored.listThreadSummaries({})).threads).toHaveLength(1);
  });
});
