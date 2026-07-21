import { describe, expect, it } from "vitest";

import { InMemoryMailboxStore } from "./store.js";
import { createDefaultMailboxService } from "./service.js";
import { FakeGmailBridge, makeGmailSnapshot, OWNER_EMAIL } from "./factories.testkit.js";

function setup() {
  const store = new InMemoryMailboxStore();
  const bridge = new FakeGmailBridge();
  const service = createDefaultMailboxService({ store, gmailBridge: bridge });
  return { store, bridge, service };
}

describe("MailboxService", () => {
  it("bootstraps a provider-neutral Gmail account with derived capabilities", async () => {
    const { service } = setup();
    const account = await service.ensureGmailAccount();
    expect(account?.email).toBe(OWNER_EMAIL);
    expect(account?.status).toBe("connected");
    expect(account?.capabilities).toContain("mail.modify");
  });

  it("reports missing_scope when the required scope is absent", async () => {
    const store = new InMemoryMailboxStore();
    const bridge = new FakeGmailBridge({
      connected: true,
      hasRequiredScope: false,
      missingScopes: ["x"],
      email: OWNER_EMAIL,
    });
    const service = createDefaultMailboxService({ store, gmailBridge: bridge });
    expect(await service.getConnectionStatus()).toBe("missing_scope");
  });

  it("lists threads through the provider and caches summaries", async () => {
    const { store, bridge, service } = setup();
    bridge.setSnapshot(makeGmailSnapshot({ threadId: "t1" }));
    await service.ensureGmailAccount();

    const page = await service.listThreads({ limit: 10 });
    expect(page.threads.length).toBeGreaterThanOrEqual(1);
    const cached = await store.listThreadSummaries({});
    expect(cached.threads.length).toBeGreaterThanOrEqual(1);
  });

  it("archives a thread through the policy gate and audits it", async () => {
    const { store, bridge, service } = setup();
    bridge.setSnapshot(
      makeGmailSnapshot({
        threadId: "t1",
        messages: [
          {
            id: "m1",
            from: "ada@example.com",
            to: OWNER_EMAIL,
            body: "hi",
            messageIdHeader: "<m1>",
          },
        ],
      }),
    );
    const account = await service.ensureGmailAccount();

    const run = await service.archiveThread("t1");
    expect(run.status).toBe("succeeded");
    expect(bridge.archived).toEqual(["t1"]);
    const audit = await store.listActionRuns(account!.id);
    expect(audit[0].actionType).toBe("archive");
  });

  it("bumps rule version only when matching logic changes", async () => {
    const { service } = setup();
    const account = await service.ensureGmailAccount();
    const rule = await service.createRule({
      accountId: account!.id,
      name: "R",
      enabled: true,
      systemType: undefined,
      runOnThreads: true,
      conditionalOperator: "AND",
      conditions: [{ type: "from_domain", op: "equals", value: "x.com" }],
      learnedPatternIds: [],
      actions: [{ id: "a", type: "archive" }],
    });
    expect(rule.version).toBe(1);

    const renamed = await service.updateRule(rule.id, { name: "R2" });
    expect(renamed.version).toBe(1); // rename does not bump

    const retargeted = await service.updateRule(rule.id, {
      conditions: [{ type: "from_domain", op: "equals", value: "y.com" }],
    });
    expect(retargeted.version).toBe(2); // condition change bumps
  });
});
