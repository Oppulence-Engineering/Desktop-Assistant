import { describe, expect, it } from "vitest";

import { deriveReplyRecipients } from "./ai.js";
import { makeMessage, makeThread, OWNER_EMAIL } from "./factories.testkit.js";

describe("deriveReplyRecipients", () => {
  it("addresses the reply to the last inbound sender, never the owner", () => {
    const thread = makeThread({
      messages: [
        makeMessage({
          providerMessageId: "m1",
          from: { email: "friend@example.com" },
          cc: [{ email: OWNER_EMAIL }, { email: "colleague@example.com" }],
        }),
        makeMessage({ providerMessageId: "m2", from: { email: OWNER_EMAIL }, isOutbound: true }),
        makeMessage({
          providerMessageId: "m3",
          from: { email: "friend@example.com" },
          cc: [{ email: "colleague@example.com" }],
        }),
      ],
    });

    const { to, cc } = deriveReplyRecipients(thread);
    expect(to.map((p) => p.email)).toEqual(["friend@example.com"]);
    expect(to.map((p) => p.email)).not.toContain(OWNER_EMAIL);
    // The owner is filtered out of cc even if they were on the thread.
    expect(cc.map((p) => p.email)).not.toContain(OWNER_EMAIL);
    expect(cc.map((p) => p.email)).toContain("colleague@example.com");
  });

  it("returns no recipients when there is no inbound message", () => {
    const thread = makeThread({
      messages: [makeMessage({ from: { email: OWNER_EMAIL }, isOutbound: true })],
    });
    expect(deriveReplyRecipients(thread).to).toHaveLength(0);
  });
});
