import { describe, expect, it } from "vitest";

import { GmailMailboxProvider } from "./provider-gmail.js";
import { MailboxProviderError } from "./errors.js";
import {
  FakeGmailBridge,
  makeAccount,
  makeGmailSnapshot,
  OWNER_EMAIL,
} from "./factories.testkit.js";

function makeProvider() {
  const account = makeAccount();
  const bridge = new FakeGmailBridge();
  return { account, bridge, provider: new GmailMailboxProvider(account, bridge) };
}

describe("GmailMailboxProvider", () => {
  it("normalizes a listed thread into a provider-neutral summary", async () => {
    const { bridge, provider } = makeProvider();
    bridge.setSnapshot(makeGmailSnapshot({ threadId: "t1", subject: "Hi" }));

    const page = await provider.listThreads({ accountId: "acct_test" });
    expect(page.threads[0].subject).toBe("Hi");
    expect(page.threads[0].providerThreadId).toBe("t1");
  });

  it("hydrates a full thread and detects outbound messages", async () => {
    const { bridge, provider } = makeProvider();
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
          {
            id: "m2",
            from: OWNER_EMAIL,
            to: "ada@example.com",
            body: "reply",
            messageIdHeader: "<m2>",
          },
        ],
      }),
    );
    const thread = await provider.getThread({
      accountId: "acct_test",
      provider: "gmail",
      providerThreadId: "t1",
    });
    expect(thread.messages[1].isOutbound).toBe(true);
  });

  it("throws not_found for a thread absent from the cache", async () => {
    const { provider } = makeProvider();
    await expect(
      provider.getThread({
        accountId: "acct_test",
        provider: "gmail",
        providerThreadId: "missing",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("delegates archive to the bridge", async () => {
    const { bridge, provider } = makeProvider();
    await provider.archiveThread({
      accountId: "acct_test",
      provider: "gmail",
      providerThreadId: "t1",
    });
    expect(bridge.archived).toEqual(["t1"]);
  });

  it("sends a reply through the bridge", async () => {
    const { bridge, provider } = makeProvider();
    const sent = await provider.reply({
      accountId: "acct_test",
      providerThreadId: "t1",
      to: [{ email: "ada@example.com" }],
      subject: "Re: Hi",
      bodyText: "sure",
    });
    expect(bridge.sentReplies).toHaveLength(1);
    expect(bridge.sentReplies[0].to).toBe("ada@example.com");
    expect(sent.providerThreadId).toBe("t1");
  });

  it("classifies a provider rate limit thrown by the bridge", async () => {
    const { bridge, provider } = makeProvider();
    bridge.failWith(() => {
      const err = new Error("too many") as Error & { status: number };
      err.status = 429;
      throw err;
    });
    await expect(provider.listThreads({ accountId: "acct_test" })).rejects.toMatchObject({
      code: "provider_rate_limited",
    });
  });

  it("throws a typed error for operations not in the desktop bridge", async () => {
    const { provider } = makeProvider();
    await expect(
      provider.createDraft({
        accountId: "acct_test",
        to: [{ email: "a@b.com" }],
        subject: "s",
        bodyText: "b",
      }),
    ).rejects.toBeInstanceOf(MailboxProviderError);
    await expect(
      provider.applyLabel(
        { accountId: "acct_test", provider: "gmail", providerThreadId: "t1" },
        "L",
      ),
    ).rejects.toBeInstanceOf(MailboxProviderError);
  });

  it("reports connection status from the bridge", async () => {
    const account = makeAccount();
    const bridge = new FakeGmailBridge({
      connected: true,
      hasRequiredScope: false,
      missingScopes: ["x"],
      email: OWNER_EMAIL,
    });
    const provider = new GmailMailboxProvider(account, bridge);
    expect(await provider.getConnectionStatus()).toBe("missing_scope");
  });
});
