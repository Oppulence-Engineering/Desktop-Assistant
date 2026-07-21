import { describe, expect, it } from "vitest";

import { InMemoryMailboxStore } from "../store.js";
import { computeThreadMessageSetVersion, ensureSingleDraftSuggestion } from "./drafts.js";
import { FakeDraftGenerator, makeMessage, makeThread } from "../factories.testkit.js";

describe("computeThreadMessageSetVersion", () => {
  it("is stable regardless of message order and changes when a message is added", () => {
    const m1 = makeMessage({ providerMessageId: "a" });
    const m2 = makeMessage({ providerMessageId: "b" });
    const v1 = computeThreadMessageSetVersion(makeThread({ messages: [m1, m2] }));
    const v1reordered = computeThreadMessageSetVersion(makeThread({ messages: [m2, m1] }));
    expect(v1).toBe(v1reordered);

    const v2 = computeThreadMessageSetVersion(
      makeThread({ messages: [m1, m2, makeMessage({ providerMessageId: "c" })] }),
    );
    expect(v2).not.toBe(v1);
  });
});

describe("ensureSingleDraftSuggestion", () => {
  it("reuses the existing draft when the thread has not changed", async () => {
    const store = new InMemoryMailboxStore();
    const generator = new FakeDraftGenerator();
    const thread = makeThread({ messages: [makeMessage({ from: { email: "a@example.com" } })] });

    const first = await ensureSingleDraftSuggestion({
      accountId: "acct_test",
      thread,
      source: "reply_zero",
      store,
      draftGenerator: generator,
    });
    const second = await ensureSingleDraftSuggestion({
      accountId: "acct_test",
      thread,
      source: "reply_zero",
      store,
      draftGenerator: generator,
    });

    expect(second.id).toBe(first.id);
    expect(generator.calls).toBe(1); // no regeneration on an unchanged thread
    expect(await store.listDraftSuggestions("acct_test")).toHaveLength(1);
  });

  it("regenerates when a new message arrives", async () => {
    const store = new InMemoryMailboxStore();
    const generator = new FakeDraftGenerator();
    const m1 = makeMessage({ providerMessageId: "a", from: { email: "a@example.com" } });
    const thread1 = makeThread({ providerThreadId: "t1", messages: [m1] });
    const first = await ensureSingleDraftSuggestion({
      accountId: "acct_test",
      thread: thread1,
      source: "reply_zero",
      store,
      draftGenerator: generator,
    });

    const thread2 = makeThread({
      providerThreadId: "t1",
      id: thread1.id,
      messages: [m1, makeMessage({ providerMessageId: "b", from: { email: "a@example.com" } })],
    });
    const second = await ensureSingleDraftSuggestion({
      accountId: "acct_test",
      thread: thread2,
      source: "reply_zero",
      store,
      draftGenerator: generator,
    });

    expect(second.id).toBe(first.id); // same draft record, updated in place
    expect(generator.calls).toBe(2);
    expect(second.threadVersion).not.toBe(first.threadVersion);
  });

  it("never overwrites a user-edited draft", async () => {
    const store = new InMemoryMailboxStore();
    const generator = new FakeDraftGenerator();
    const thread = makeThread({ messages: [makeMessage({ from: { email: "a@example.com" } })] });
    const draft = await ensureSingleDraftSuggestion({
      accountId: "acct_test",
      thread,
      source: "reply_zero",
      store,
      draftGenerator: generator,
    });
    await store.updateDraftSuggestion(draft.id, { status: "edited", bodyText: "my own words" });

    // A new message arrives, but the user already edited the draft.
    const thread2 = makeThread({
      id: thread.id,
      providerThreadId: thread.providerThreadId,
      messages: [
        ...thread.messages,
        makeMessage({ providerMessageId: "z", from: { email: "a@example.com" } }),
      ],
    });
    const after = await ensureSingleDraftSuggestion({
      accountId: "acct_test",
      thread: thread2,
      source: "reply_zero",
      store,
      draftGenerator: generator,
    });
    expect(after.bodyText).toBe("my own words");
    expect(generator.calls).toBe(1);
  });
});
