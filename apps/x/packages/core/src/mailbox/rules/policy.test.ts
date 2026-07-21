import { describe, expect, it } from "vitest";

import { decideActionPolicy, isHighImpactAction } from "./policy.js";
import { makeAccount } from "../factories.testkit.js";

const account = makeAccount();

describe("decideActionPolicy", () => {
  it("allows low-risk reversible actions without approval", () => {
    const decision = decideActionPolicy({
      action: { id: "a", type: "archive" },
      account,
      source: "rule",
    });
    expect(decision).toMatchObject({ allowed: true, requiresApproval: false });
  });

  it("denies an action when the capability is missing", () => {
    const readonly = makeAccount({ capabilities: ["mail.read"] });
    const decision = decideActionPolicy({
      action: { id: "a", type: "archive" },
      account: readonly,
      source: "rule",
    });
    expect(decision.allowed).toBe(false);
  });

  it("requires approval to send a reply by default", () => {
    const decision = decideActionPolicy({
      action: { id: "a", type: "reply" },
      account,
      source: "rule",
    });
    expect(decision).toMatchObject({ allowed: true, requiresApproval: true, approvalKind: "send" });
  });

  it("gates mark_spam behind confirmation", () => {
    const decision = decideActionPolicy({
      action: { id: "a", type: "mark_spam" },
      account,
      source: "rule",
    });
    expect(decision).toMatchObject({ requiresApproval: true, approvalKind: "spam" });
  });

  it("allows a metadata-only webhook but gates a body-bearing one", () => {
    const meta = decideActionPolicy({
      action: {
        id: "a",
        type: "webhook",
        destinationId: "d",
        payloadPolicy: { includeBody: false, includeAttachments: false },
      },
      account,
      source: "rule",
    });
    expect(meta).toMatchObject({ allowed: true, requiresApproval: false });

    const withBody = decideActionPolicy({
      action: {
        id: "a",
        type: "webhook",
        destinationId: "d",
        payloadPolicy: { includeBody: true, includeAttachments: false },
      },
      account,
      source: "rule",
    });
    expect(withBody).toMatchObject({ requiresApproval: true, approvalKind: "external_payload" });
  });

  it("allowlists forward recipients to skip approval", () => {
    const allowed = decideActionPolicy({
      action: { id: "a", type: "forward", to: ["ok@x.com"] },
      account,
      source: "rule",
      forwardAllowlist: ["ok@x.com"],
    });
    expect(allowed).toMatchObject({ requiresApproval: false });

    const notAllowed = decideActionPolicy({
      action: { id: "a", type: "forward", to: ["stranger@x.com"] },
      account,
      source: "rule",
      forwardAllowlist: ["ok@x.com"],
    });
    expect(notAllowed).toMatchObject({ requiresApproval: true });
  });
});

describe("isHighImpactAction", () => {
  it("classifies send/forward/spam/trash/external as high impact", () => {
    for (const type of [
      "send_email",
      "reply",
      "forward",
      "mark_spam",
      "trash",
      "webhook",
    ] as const) {
      expect(isHighImpactAction(type)).toBe(true);
    }
    expect(isHighImpactAction("archive")).toBe(false);
  });
});
