import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  awaitApprovalAndRetry,
  cancelPendingMcpApprovals,
  canonicalArgumentsDigest,
  classifyDirectProductMcpError,
  configureMcpApprovalUrlOpener,
  pendingMcpApprovalCount,
  parseMcpApprovalDeepLink,
  registerMcpApprovalResult,
  snapshotMcpArguments,
} from "./product-approval.js";

const challengeError = {
  status: 428,
  body: JSON.stringify({
    approvalRequired: true,
    approvalChallengeUrl: "https://corinthian.example/approvals/appr_123",
    actor: "user_123",
    action: "payment.release",
  }),
};

describe("direct product MCP authorization behavior", () => {
  beforeEach(() => configureMcpApprovalUrlOpener(async () => {}));
  afterEach(() => {
    cancelPendingMcpApprovals("test cleanup");
    vi.useRealTimers();
  });

  it("distinguishes 401, 403, reauth, and policy invalidation", () => {
    expect(classifyDirectProductMcpError({ status: 401 }).kind).toBe("authentication_required");
    expect(classifyDirectProductMcpError({ status: 403 }).kind).toBe("forbidden");
    expect(
      classifyDirectProductMcpError({ status: 401, body: '{"code":"token_expired"}' }).kind,
    ).toBe("reauth_required");
    expect(
      classifyDirectProductMcpError({ status: 403, body: '{"code":"connection_invalidated"}' })
        .kind,
    ).toBe("policy_invalidated");
  });

  it("automatically resumes exactly the original call once after a matching approval", async () => {
    let opened!: URL;
    configureMcpApprovalUrlOpener(async (url) => {
      opened = new URL(url);
    });
    const input = { amount: 1200, destination: { id: "acct_7", kind: "vendor" } };
    const retry = vi.fn(async (token: string) => ({ token, input }));
    const resultPromise = awaitApprovalAndRetry(
      "rowboat-corinthian",
      "release_payment",
      input,
      challengeError,
      retry,
    );
    await vi.waitFor(() => expect(opened).toBeDefined());

    const completion = {
      challengeId: opened.searchParams.get("desktop_challenge_id")!,
      serverName: opened.searchParams.get("desktop_server")!,
      toolName: opened.searchParams.get("desktop_tool")!,
      argumentsDigest: opened.searchParams.get("desktop_arguments_digest")!,
      actor: opened.searchParams.get("desktop_actor")!,
      action: opened.searchParams.get("desktop_action")!,
      status: "approved" as const,
      token: "one-time-token",
    };
    expect(registerMcpApprovalResult(completion)).toBe(true);
    await expect(resultPromise).resolves.toEqual({ token: "one-time-token", input });
    expect(retry).toHaveBeenCalledOnce();
    expect(registerMcpApprovalResult(completion)).toBe(false);
    expect(retry).toHaveBeenCalledOnce();
    expect(pendingMcpApprovalCount()).toBe(0);
  });

  it("resumes through the packaged desktop approval deep-link adapter", async () => {
    let opened!: URL;
    configureMcpApprovalUrlOpener(async (url) => {
      opened = new URL(url);
    });
    const retry = vi.fn(async (token: string) => token);
    const resultPromise = awaitApprovalAndRetry(
      "rowboat-cadence",
      "payment.execute",
      { paymentRunId: "run_123" },
      challengeError,
      retry,
    );
    await vi.waitFor(() => expect(opened).toBeDefined());

    const completionUrl = new URL("oppulence://mcp-approval");
    completionUrl.searchParams.set(
      "challenge_id",
      opened.searchParams.get("desktop_challenge_id")!,
    );
    completionUrl.searchParams.set("server", opened.searchParams.get("desktop_server")!);
    completionUrl.searchParams.set("tool", opened.searchParams.get("desktop_tool")!);
    completionUrl.searchParams.set(
      "arguments_digest",
      opened.searchParams.get("desktop_arguments_digest")!,
    );
    completionUrl.searchParams.set("actor", opened.searchParams.get("desktop_actor")!);
    completionUrl.searchParams.set("action", opened.searchParams.get("desktop_action")!);
    completionUrl.searchParams.set("status", "approved");
    completionUrl.searchParams.set("approval_token", "packaged-one-time-token");

    const completion = parseMcpApprovalDeepLink(completionUrl.toString());
    expect(completion).not.toBeNull();
    expect(registerMcpApprovalResult(completion!)).toBe(true);
    await expect(resultPromise).resolves.toBe("packaged-one-time-token");
    expect(retry).toHaveBeenCalledOnce();
  });

  it("canonicalizes and freezes the approved retry arguments against caller mutation", async () => {
    const original = { z: 1, nested: { amount: 1200 }, items: [{ id: "acct_7" }] };
    const snapshot = snapshotMcpArguments(original);
    original.nested.amount = 9999;
    original.items[0].id = "attacker";

    expect(snapshot).toEqual({ items: [{ id: "acct_7" }], nested: { amount: 1200 }, z: 1 });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.nested)).toBe(true);
    expect(Object.isFrozen(snapshot.items)).toBe(true);
    expect(canonicalArgumentsDigest(snapshot)).toBe(
      canonicalArgumentsDigest({ z: 1, nested: { amount: 1200 }, items: [{ id: "acct_7" }] }),
    );
  });

  it.each([
    ["server", { serverName: "wrong-server" }],
    ["tool", { toolName: "wrong-tool" }],
    ["arguments", { argumentsDigest: canonicalArgumentsDigest({ amount: 999 }) }],
    ["actor", { actor: "other-user" }],
    ["action", { action: "payment.cancel" }],
  ])("rejects a completion with mismatched %s and clears it", async (_label, mismatch) => {
    let opened!: URL;
    configureMcpApprovalUrlOpener(async (url) => {
      opened = new URL(url);
    });
    const retry = vi.fn(async () => "should-not-run");
    const resultPromise = awaitApprovalAndRetry(
      "server",
      "tool",
      { amount: 1 },
      challengeError,
      retry,
    );
    await vi.waitFor(() => expect(opened).toBeDefined());
    const completion = {
      challengeId: opened.searchParams.get("desktop_challenge_id")!,
      serverName: "server",
      toolName: "tool",
      argumentsDigest: opened.searchParams.get("desktop_arguments_digest")!,
      actor: "user_123",
      action: "payment.release",
      status: "approved" as const,
      token: "token",
      ...mismatch,
    };
    expect(registerMcpApprovalResult(completion)).toBe(false);
    await expect(resultPromise).rejects.toThrow(/did not match/);
    expect(retry).not.toHaveBeenCalled();
    expect(pendingMcpApprovalCount()).toBe(0);
  });

  it.each(["denied", "cancelled", "expired"] as const)(
    "rejects %s completion without retry",
    async (status) => {
      let opened!: URL;
      configureMcpApprovalUrlOpener(async (url) => {
        opened = new URL(url);
      });
      const retry = vi.fn(async () => "should-not-run");
      const resultPromise = awaitApprovalAndRetry("server", "tool", {}, challengeError, retry);
      await vi.waitFor(() => expect(opened).toBeDefined());
      registerMcpApprovalResult({
        challengeId: opened.searchParams.get("desktop_challenge_id")!,
        serverName: "server",
        toolName: "tool",
        argumentsDigest: opened.searchParams.get("desktop_arguments_digest")!,
        actor: "user_123",
        action: "payment.release",
        status,
      });
      await expect(resultPromise).rejects.toThrow(new RegExp(status));
      expect(retry).not.toHaveBeenCalled();
    },
  );

  it("rejects unsolicited completions and expires bounded in-memory state", async () => {
    expect(
      registerMcpApprovalResult({
        challengeId: "unguessable-but-unsolicited",
        serverName: "server",
        toolName: "tool",
        argumentsDigest: "digest",
        status: "approved",
        token: "token",
      }),
    ).toBe(false);

    vi.useFakeTimers();
    const resultPromise = awaitApprovalAndRetry(
      "server",
      "tool",
      {},
      challengeError,
      async () => "no",
    );
    const rejection = expect(resultPromise).rejects.toThrow(/expired/);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await rejection;
    expect(pendingMcpApprovalCount()).toBe(0);
  });

  it("does not open unsafe challenge URLs", async () => {
    const open = vi.fn(async () => {});
    configureMcpApprovalUrlOpener(open);
    await expect(
      awaitApprovalAndRetry(
        "server",
        "tool",
        {},
        {
          status: 428,
          body: '{"approvalChallengeUrl":"javascript:alert(1)"}',
        },
        async () => null,
      ),
    ).rejects.toThrow(/unsafe/);
    expect(open).not.toHaveBeenCalled();
  });
});
