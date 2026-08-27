import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyDirectProductMcpError,
  configureMcpApprovalUrlOpener,
  consumeMcpApprovalToken,
  handleApprovalChallenge,
  registerMcpApprovalResult,
} from "./product-approval.js";

describe("direct product MCP authorization behavior", () => {
  beforeEach(() => configureMcpApprovalUrlOpener(async () => {}));

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

  it("opens a trusted 428 challenge and establishes an explicit retry boundary", async () => {
    const open = vi.fn(async () => {});
    configureMcpApprovalUrlOpener(open);
    const result = await handleApprovalChallenge("rowboat-corinthian", {
      status: 428,
      body: '{"approvalRequired":true,"approvalChallengeUrl":"https://corinthian.example/approvals/appr_123"}',
    });
    expect(result.kind).toBe("approval_required");
    expect(result.message).toMatch(/explicitly retry/);
    expect(open).toHaveBeenCalledWith("https://corinthian.example/approvals/appr_123");
  });

  it("consumes a callback approval token once for retry", () => {
    registerMcpApprovalResult("rowboat-corinthian", "one-time-token");
    expect(consumeMcpApprovalToken("rowboat-corinthian")).toBe("one-time-token");
    expect(consumeMcpApprovalToken("rowboat-corinthian")).toBeUndefined();
  });

  it("does not open unsafe challenge URLs", async () => {
    const open = vi.fn(async () => {});
    configureMcpApprovalUrlOpener(open);
    const result = await handleApprovalChallenge("server", {
      status: 428,
      body: '{"approvalChallengeUrl":"javascript:alert(1)"}',
    });
    expect(result.message).toMatch(/unsafe/);
    expect(open).not.toHaveBeenCalled();
  });
});
