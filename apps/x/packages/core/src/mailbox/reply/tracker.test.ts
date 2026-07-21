import { describe, expect, it } from "vitest";

import { InMemoryMailboxStore } from "../store.js";
import { ReplyTrackerService } from "./tracker.js";
import { FakeReplyClassifier, makeMessage, makeThread, OWNER_EMAIL } from "../factories.testkit.js";

describe("ReplyTrackerService", () => {
  it("moves a thread to needs_reply on an inbound question", async () => {
    const store = new InMemoryMailboxStore();
    const service = new ReplyTrackerService({
      store,
      classifier: new FakeReplyClassifier({ status: "needs_reply" }),
    });
    const thread = makeThread({ messages: [makeMessage({ from: { email: "a@example.com" } })] });

    const tracker = await service.processThread("acct_test", thread);
    expect(tracker.status).toBe("needs_reply");
    expect(tracker.lastInboundMessageId).toBe(thread.messages[0].id);
  });

  it("moves a thread to awaiting_reply on the owner's outbound", async () => {
    const store = new InMemoryMailboxStore();
    const service = new ReplyTrackerService({
      store,
      classifier: new FakeReplyClassifier({ status: "done" }, true),
    });
    const thread = makeThread({
      messages: [makeMessage({ from: { email: OWNER_EMAIL }, isOutbound: true })],
    });

    const tracker = await service.processThread("acct_test", thread);
    expect(tracker.status).toBe("awaiting_reply");
  });

  it("is idempotent across repeated syncs of the same latest message", async () => {
    const store = new InMemoryMailboxStore();
    const classifier = new FakeReplyClassifier({ status: "needs_reply" });
    let classifyCalls = 0;
    const spy = {
      classifyInbound: async (i: Parameters<typeof classifier.classifyInbound>[0]) => {
        classifyCalls += 1;
        return classifier.classifyInbound(i);
      },
      outboundExpectsReply: classifier.outboundExpectsReply.bind(classifier),
    };
    const service = new ReplyTrackerService({ store, classifier: spy });
    const thread = makeThread({ messages: [makeMessage({ from: { email: "a@example.com" } })] });

    await service.processThread("acct_test", thread);
    await service.processThread("acct_test", thread);
    expect(classifyCalls).toBe(1);
  });

  it("supports user mark done", async () => {
    const store = new InMemoryMailboxStore();
    const service = new ReplyTrackerService({
      store,
      classifier: new FakeReplyClassifier({ status: "needs_reply" }),
    });
    const thread = makeThread({ messages: [makeMessage({ from: { email: "a@example.com" } })] });
    await service.processThread("acct_test", thread);

    const done = await service.markDone("acct_test", thread.id);
    expect(done?.status).toBe("done");
  });

  it("lists trackers due for a nudge once the due date passes", async () => {
    const DAY = 24 * 60 * 60 * 1000;
    let clock = 1_000_000;
    const store = new InMemoryMailboxStore();
    const service = new ReplyTrackerService({
      store,
      classifier: new FakeReplyClassifier({ status: "done" }, true),
      now: () => clock,
    });
    // Owner sends an outbound that expects a reply -> awaiting_reply, due in 3 days.
    const thread = makeThread({
      messages: [makeMessage({ from: { email: OWNER_EMAIL }, isOutbound: true, sentAt: clock })],
    });
    await service.processThread("acct_test", thread);

    // Before the due date: not yet a nudge candidate.
    expect(await service.listDueForNudge("acct_test")).toHaveLength(0);

    // Advance past the awaiting-reply window.
    clock += 10 * DAY;
    expect(await service.listDueForNudge("acct_test")).toHaveLength(1);
  });
});
