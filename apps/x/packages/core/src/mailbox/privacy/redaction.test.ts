import { describe, expect, it } from "vitest";

import { redactEmailForLog, redactStringForLog, redactThreadForPrompt } from "./redaction.js";
import { makeMessage, makeThread } from "../factories.testkit.js";

describe("redaction", () => {
  it("masks the local part of an email for logs", () => {
    expect(redactEmailForLog("ada@example.com")).toBe("a***@example.com");
  });

  it("redacts every address in a string", () => {
    const redacted = redactStringForLog("from ada@example.com to bob@company.io");
    expect(redacted).not.toContain("ada@example.com");
    expect(redacted).toContain("@example.com");
    expect(redacted).toContain("@company.io");
  });

  it("caps body length and message count in the prompt view", () => {
    const messages = Array.from({ length: 12 }, (_, i) =>
      makeMessage({ providerMessageId: `m${i}`, textBody: "x".repeat(5000) }),
    );
    const thread = makeThread({ messages });
    const view = redactThreadForPrompt(thread, { maxMessages: 3, maxBodyChars: 100 });
    expect(view.messages).toHaveLength(3);
    expect(view.messages[0].body.length).toBeLessThanOrEqual(100);
    expect(view.messageCount).toBe(12);
  });
});
