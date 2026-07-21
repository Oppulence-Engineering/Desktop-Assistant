import { describe, expect, it } from "vitest";

import { InMemoryMailboxStore } from "./store.js";
import { DefaultMailboxProviderRegistry } from "./provider-registry.js";
import { MailboxSyncController } from "./sync-controller.js";
import { MailboxProviderError } from "./errors.js";
import { FakeGmailBridge, makeAccount, makeGmailSnapshot } from "./factories.testkit.js";

const NOW = 1_700_000_000_000;

async function setup() {
  const store = new InMemoryMailboxStore();
  const account = makeAccount();
  await store.upsertAccount(account);
  const bridge = new FakeGmailBridge();
  const providers = new DefaultMailboxProviderRegistry({ store, gmailBridge: bridge });
  const controller = new MailboxSyncController({ store, providers, now: () => NOW });
  return { store, bridge, controller, account };
}

describe("MailboxSyncController", () => {
  it("syncs threads into the local store and marks the account connected", async () => {
    const { store, bridge, controller, account } = await setup();
    bridge.setSnapshot(makeGmailSnapshot({ threadId: "t1" }));

    const result = await controller.syncAccount(account.id);
    expect(result.ok).toBe(true);
    expect(result.threadsSynced).toBeGreaterThanOrEqual(1);
    expect((await store.getAccount(account.id))?.status).toBe("connected");
    expect(result.state.mode).toBe("idle");
  });

  it("backs off and records error state on a provider rate limit", async () => {
    const { store, bridge, controller, account } = await setup();
    bridge.failWith(() => {
      throw new MailboxProviderError("rate limited", "provider_rate_limited", {
        provider: "gmail",
        operation: "listThreads",
        accountId: account.id,
        retryAfterMs: 60_000,
        status: 429,
      });
    });

    const result = await controller.syncAccount(account.id);
    expect(result.ok).toBe(false);
    expect(result.state.mode).toBe("backoff");
    expect(result.state.nextAttemptAt).toBe(NOW + 60_000);
    expect(await controller.isBackedOff(account.id)).toBe(true);
    expect((await store.getAccount(account.id))?.status).toBe("rate_limited");
  });

  it("marks the account needs_reconnect on an auth error", async () => {
    const { store, bridge, controller, account } = await setup();
    bridge.failWith(() => {
      throw new MailboxProviderError("reconnect", "auth_reconnect_required", {
        provider: "gmail",
        operation: "listThreads",
        accountId: account.id,
        status: 401,
      });
    });

    await controller.syncAccount(account.id);
    expect((await store.getAccount(account.id))?.status).toBe("needs_reconnect");
    expect((await store.getSyncState(account.id))?.mode).toBe("needs_reconnect");
  });

  it("does not attempt a sync while backed off", async () => {
    const { store, bridge, controller, account } = await setup();
    await store.updateSyncState(account.id, { nextAttemptAt: NOW + 100_000, mode: "backoff" });
    bridge.setSnapshot(makeGmailSnapshot({ threadId: "t1" }));

    const result = await controller.syncAccount(account.id);
    expect(result.ok).toBe(false);
    expect(result.threadsSynced).toBe(0);
  });
});
