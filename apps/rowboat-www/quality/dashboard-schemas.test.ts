import { describe, expect, it } from "vitest";

import {
  ApprovalTokenResponseSchema,
  CreatedAgentSessionSchema,
  TextContentResponseSchema,
  parseJsonObject,
} from "@/lib/dashboard-schemas";

describe("dashboard API schemas", () => {
  it("normalizes current and legacy session identifiers", () => {
    expect(CreatedAgentSessionSchema.parse({ sessionId: "session-1" })).toEqual({
      sessionId: "session-1",
    });
    expect(CreatedAgentSessionSchema.parse({ id: "legacy-session" })).toEqual({
      sessionId: "legacy-session",
    });
    expect(() => CreatedAgentSessionSchema.parse({})).toThrow();
  });

  it("rejects malformed approval and text responses", () => {
    expect(ApprovalTokenResponseSchema.parse({ approvalToken: "signed-token" })).toMatchObject({
      approvalToken: "signed-token",
    });
    expect(() => ApprovalTokenResponseSchema.parse({ approvalToken: 42 })).toThrow();
    expect(() => TextContentResponseSchema.parse({ content: { nested: true } })).toThrow();
  });

  it("accepts only object-shaped JSON editor documents", () => {
    expect(parseJsonObject('{"providers":{}}')).toEqual({ providers: {} });
    expect(() => parseJsonObject("[]")).toThrow();
    expect(() => parseJsonObject("{")).toThrow("not valid JSON");
  });
});
