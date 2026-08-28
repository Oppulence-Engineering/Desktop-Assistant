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
import {
  mcpAuthorizationSessionFingerprint,
  mcpHeadersDigest,
  normalizeMcpEndpoint,
  type McpApprovalRequestBinding,
} from "./approval-request.js";

const challengeError = {
  status: 428,
  body: JSON.stringify({
    approvalRequired: true,
    approvalChallengeUrl: "https://product.example/approvals/appr_123",
    actor: "user_123",
    action: "payment.release",
  }),
};

function binding(toolName: string, input: Record<string, unknown>): McpApprovalRequestBinding {
  const headers = { Authorization: "Bearer ordinary", "mcp-session-id": "session-1" };
  return {
    serverName: "product",
    configuredEndpoint: normalizeMcpEndpoint("https://product.example/mcp"),
    connectionId: "connection-1",
    configGeneration: 1,
    configDigest: "config-digest",
    configuredHeadersDigest: mcpHeadersDigest({ Authorization: "Bearer ordinary" }),
    credentialFingerprint: mcpAuthorizationSessionFingerprint({ Authorization: "Bearer ordinary" }),
    endpoint: normalizeMcpEndpoint("https://product.example/mcp"),
    headersDigest: mcpHeadersDigest(headers),
    authorizationSessionFingerprint: mcpAuthorizationSessionFingerprint(headers),
    sessionId: "session-1",
    toolName,
    argumentsDigest: canonicalArgumentsDigest(input),
  };
}

function redeem(token = "approval-bearer-secret") {
  return vi.fn(async () => ({ approvalToken: token }));
}

describe("direct product MCP approval completion", () => {
  beforeEach(() => configureMcpApprovalUrlOpener(async () => {}));
  afterEach(() => cancelPendingMcpApprovals("test cleanup"));

  it("distinguishes authorization failures", () => {
    expect(classifyDirectProductMcpError({ status: 401 }).kind).toBe("authentication_required");
    expect(classifyDirectProductMcpError({ status: 403 }).kind).toBe("forbidden");
    expect(
      classifyDirectProductMcpError({ status: 401, body: '{"code":"token_expired"}' }).kind,
    ).toBe("reauth_required");
  });

  it("puts only an opaque code in the protocol URL and redeems before one-shot retry", async () => {
    let opened!: URL;
    configureMcpApprovalUrlOpener(async (url) => {
      opened = new URL(url);
    });
    const retry = vi.fn(async (token: string) => token);
    const redemption = redeem();
    const input = { amount: 1200, destination: "acct_7" };
    const result = awaitApprovalAndRetry(
      "product",
      "payment.execute",
      input,
      challengeError,
      binding("payment.execute", input),
      retry,
      redemption,
    );
    await vi.waitFor(() => expect(opened).toBeDefined());

    expect(opened.origin).toBe("https://product.example");
    expect(opened.searchParams.get("desktop_code_challenge_method")).toBe("S256");
    expect(opened.searchParams.get("desktop_code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(opened.toString()).not.toMatch(/approval[-_]?token|bearer|approval-bearer-secret/i);

    const callback = new URL("oppulence://mcp-approval");
    callback.searchParams.set("challenge_id", opened.searchParams.get("desktop_challenge_id")!);
    callback.searchParams.set("status", "approved");
    callback.searchParams.set("code", "opaque-single-use-code");
    expect(callback.toString()).not.toMatch(/token|bearer/i);
    const parsed = parseMcpApprovalDeepLink(callback.toString());
    expect(parsed).toEqual({
      challengeId: expect.any(String),
      status: "approved",
      code: "opaque-single-use-code",
    });
    expect(registerMcpApprovalResult(parsed!)).toBe(true);
    await expect(result).resolves.toBe("approval-bearer-secret");
    expect(redemption).toHaveBeenCalledWith(
      "opaque-single-use-code",
      expect.any(String),
      "https://product.example",
      expect.objectContaining({
        connectionId: "connection-1",
        toolName: "payment.execute",
        argumentsDigest: canonicalArgumentsDigest(input),
        actor: "user_123",
        action: "payment.release",
      }),
    );
    expect(retry).toHaveBeenCalledOnce();
    expect(registerMcpApprovalResult(parsed!)).toBe(false);
  });

  it("rejects bearer credentials in protocol arguments", () => {
    for (const name of ["approval_token", "token"]) {
      const callback = new URL("oppulence://mcp-approval");
      callback.searchParams.set("challenge_id", "challenge");
      callback.searchParams.set("code", "code");
      callback.searchParams.set(name, "raw-bearer-secret");
      expect(parseMcpApprovalDeepLink(callback.toString())).toBeNull();
    }
  });

  it("does not expose a bearer in deep-link parse results, errors, or opener arguments", async () => {
    let opened = "";
    configureMcpApprovalUrlOpener(async (url) => {
      opened = url;
    });
    const redemption = vi.fn(async () => {
      throw new Error("Approval code redemption failed (400).");
    });
    const promise = awaitApprovalAndRetry(
      "product",
      "payment.execute",
      {},
      challengeError,
      binding("payment.execute", {}),
      vi.fn(),
      redemption,
    );
    await vi.waitFor(() => expect(opened).not.toBe(""));
    const u = new URL("oppulence://mcp-approval");
    u.searchParams.set("challenge_id", new URL(opened).searchParams.get("desktop_challenge_id")!);
    u.searchParams.set("code", "opaque-code");
    registerMcpApprovalResult(parseMcpApprovalDeepLink(u.toString())!);
    await expect(promise).rejects.toThrow("Approval code redemption failed (400).");
    expect(opened + u.toString()).not.toContain("approval-bearer-secret");
  });

  it("rejects a wrong product origin before opening", async () => {
    const open = vi.fn();
    configureMcpApprovalUrlOpener(open);
    await expect(
      awaitApprovalAndRetry(
        "product",
        "tool",
        {},
        { status: 428, body: '{"approvalChallengeUrl":"https://evil.example/approve"}' },
        binding("tool", {}),
        vi.fn(),
        redeem(),
      ),
    ).rejects.toThrow(/exact product origin/);
    expect(open).not.toHaveBeenCalled();
  });

  it("clears pending state before redemption so code replay cannot redeem twice", async () => {
    let opened!: URL;
    configureMcpApprovalUrlOpener(async (url) => {
      opened = new URL(url);
    });
    const redemption = redeem();
    const promise = awaitApprovalAndRetry(
      "product",
      "tool",
      {},
      challengeError,
      binding("tool", {}),
      vi.fn(async () => "ok"),
      redemption,
    );
    await vi.waitFor(() => expect(opened).toBeDefined());
    const completion = {
      challengeId: opened.searchParams.get("desktop_challenge_id")!,
      status: "approved" as const,
      code: "single-use",
    };
    expect(registerMcpApprovalResult(completion)).toBe(true);
    expect(registerMcpApprovalResult(completion)).toBe(false);
    await expect(promise).resolves.toBe("ok");
    expect(redemption).toHaveBeenCalledOnce();
    expect(pendingMcpApprovalCount()).toBe(0);
  });

  it("canonicalizes and freezes exact approved arguments", () => {
    const original = { z: 1, nested: { amount: 1200 } };
    const snapshot = snapshotMcpArguments(original);
    original.nested.amount = 9999;
    expect(snapshot).toEqual({ nested: { amount: 1200 }, z: 1 });
    expect(Object.isFrozen(snapshot.nested)).toBe(true);
  });
});
