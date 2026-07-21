import { describe, expect, it } from "vitest";

import { InMemoryMailboxStore } from "../store.js";
import { DefaultMailboxProviderRegistry } from "../provider-registry.js";
import { MailboxActionRunner } from "./actions.js";
import { MailboxAuditLog } from "./audit.js";
import { MailboxScheduledActionScheduler } from "./scheduler.js";
import { MailboxRuleEngine, evaluateLearnedPatterns } from "./engine.js";
import {
  FakeAiMatcher,
  FakeGmailBridge,
  makeAccount,
  makeMessage,
  makeRule,
  makeThread,
} from "../factories.testkit.js";

async function setup() {
  const store = new InMemoryMailboxStore();
  const account = makeAccount();
  await store.upsertAccount(account);
  const bridge = new FakeGmailBridge();
  const providers = new DefaultMailboxProviderRegistry({ store, gmailBridge: bridge });
  const audit = new MailboxAuditLog(store);
  const scheduler = new MailboxScheduledActionScheduler({ store });
  const actionRunner = new MailboxActionRunner({ store, providers, audit, scheduler });
  const engine = new MailboxRuleEngine({
    store,
    aiMatcher: new FakeAiMatcher(),
    actionRunner,
    audit,
  });
  return { store, bridge, engine, account };
}

describe("MailboxRuleEngine", () => {
  it("deduplicates the same provider message for the same rule version", async () => {
    const { store, bridge, engine } = await setup();
    await store.createRule(
      makeRule({
        conditions: [{ type: "from_domain", op: "equals", value: "example.com" }],
        actions: [{ id: "act_1", type: "archive" }],
      }),
    );

    const message = makeMessage({
      providerMessageId: "gmail-msg-1",
      from: { email: "a@example.com" },
    });
    const thread = makeThread({ providerThreadId: "gmail-thread-1", messages: [message] });

    await engine.processMessage({ accountId: "acct_test", thread, message, trigger: "sync" });
    await engine.processMessage({ accountId: "acct_test", thread, message, trigger: "sync" });

    // The archive side effect and the audit row happen exactly once.
    expect(bridge.archived).toEqual(["gmail-thread-1"]);
    expect(await store.listRuleRuns("acct_test")).toHaveLength(1);
  });

  it("skips the account owner's own outbound messages", async () => {
    const { store, engine } = await setup();
    await store.createRule(
      makeRule({
        conditions: [{ type: "subject", op: "contains", value: "x" }],
        actions: [{ id: "a", type: "archive" }],
      }),
    );
    const message = makeMessage({ from: { email: makeAccount().email }, subject: "x" });
    const thread = makeThread({ messages: [message] });

    const runs = await engine.processMessage({
      accountId: "acct_test",
      thread,
      message,
      trigger: "sync",
    });
    expect(runs).toHaveLength(0);
  });

  it("does not execute actions in manual_test mode", async () => {
    const { store, bridge, engine } = await setup();
    await store.createRule(
      makeRule({
        conditions: [{ type: "from_domain", op: "equals", value: "example.com" }],
        actions: [{ id: "a", type: "archive" }],
      }),
    );
    const message = makeMessage({ from: { email: "a@example.com" } });
    const thread = makeThread({ messages: [message] });

    const runs = await engine.processMessage({
      accountId: "acct_test",
      thread,
      message,
      trigger: "manual_test",
    });
    expect(runs[0].status).toBe("matched");
    expect(bridge.archived).toHaveLength(0);
  });

  it("records a needs_approval audit row instead of sending", async () => {
    const { store, engine } = await setup();
    await store.createRule(
      makeRule({
        conditions: [{ type: "from_domain", op: "equals", value: "example.com" }],
        actions: [{ id: "a", type: "reply" }],
      }),
    );
    const message = makeMessage({ from: { email: "a@example.com" } });
    const thread = makeThread({ messages: [message] });

    await engine.processMessage({ accountId: "acct_test", thread, message, trigger: "sync" });
    const actionRuns = await store.listActionRuns("acct_test");
    expect(actionRuns[0].status).toBe("needs_approval");
  });
});

describe("evaluateLearnedPatterns", () => {
  const now = Date.now();
  const message = makeMessage({ from: { email: "a@known.com" } });

  it("force-skips on a negative sender pattern", () => {
    const verdict = evaluateLearnedPatterns(
      [
        {
          id: "p1",
          accountId: "acct_test",
          ruleId: "rule_1",
          scope: "sender",
          value: "a@known.com",
          polarity: "negative",
          confidence: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
      message,
    );
    expect(verdict.kind).toBe("force_skip");
  });

  it("force-matches on a high-confidence positive domain pattern", () => {
    const verdict = evaluateLearnedPatterns(
      [
        {
          id: "p1",
          accountId: "acct_test",
          ruleId: "rule_1",
          scope: "domain",
          value: "known.com",
          polarity: "positive",
          confidence: 0.95,
          createdAt: now,
          updatedAt: now,
        },
      ],
      message,
    );
    expect(verdict.kind).toBe("force_match");
  });

  it("returns none when confidence is low", () => {
    const verdict = evaluateLearnedPatterns(
      [
        {
          id: "p1",
          accountId: "acct_test",
          ruleId: "rule_1",
          scope: "domain",
          value: "known.com",
          polarity: "positive",
          confidence: 0.5,
          createdAt: now,
          updatedAt: now,
        },
      ],
      message,
    );
    expect(verdict.kind).toBe("none");
  });
});
