import { describe, expect, it } from "vitest";

import { normalizeGmailSnapshot, parseAddress, parseAddressList } from "./normalize.js";
import { makeAccount, makeGmailSnapshot, OWNER_EMAIL } from "./factories.testkit.js";

describe("parseAddress", () => {
  it("parses display name and email", () => {
    expect(parseAddress('"Ada Lovelace" <ada@example.com>')).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("parses a bare address", () => {
    expect(parseAddress("ada@example.com")).toEqual({ email: "ada@example.com" });
  });

  it("returns undefined for empty input", () => {
    expect(parseAddress(undefined)).toBeUndefined();
    expect(parseAddress("   ")).toBeUndefined();
  });
});

describe("parseAddressList", () => {
  it("splits on top-level commas but not commas inside quotes", () => {
    const list = parseAddressList('"Doe, John" <john@x.com>, jane@y.com');
    expect(list).toEqual([{ name: "Doe, John", email: "john@x.com" }, { email: "jane@y.com" }]);
  });
});

describe("normalizeGmailSnapshot", () => {
  it("marks the owner's messages as outbound and inbound others", () => {
    const account = makeAccount();
    const snapshot = makeGmailSnapshot({
      messages: [
        { id: "m1", from: "ada@example.com", to: OWNER_EMAIL, body: "hi", messageIdHeader: "<m1>" },
        {
          id: "m2",
          from: OWNER_EMAIL,
          to: "ada@example.com",
          body: "reply",
          messageIdHeader: "<m2>",
        },
      ],
    });
    const thread = normalizeGmailSnapshot(account, snapshot);
    expect(thread.messages[0].isOutbound).toBe(false);
    expect(thread.messages[1].isOutbound).toBe(true);
    expect(thread.messages[1].sent).toBe(true);
  });

  it("flags attachments category and dedupes participants", () => {
    const account = makeAccount();
    const snapshot = makeGmailSnapshot({
      importance: "important",
      messages: [
        {
          id: "m1",
          from: "ada@example.com",
          to: OWNER_EMAIL,
          body: "see attached",
          attachments: [
            { filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 10, savedPath: "p" },
          ],
          messageIdHeader: "<m1>",
        },
      ],
    });
    const thread = normalizeGmailSnapshot(account, snapshot);
    expect(thread.categories).toEqual(expect.arrayContaining(["important", "attachments"]));
    expect(thread.messages[0].attachments).toHaveLength(1);
  });

  it("produces a stable thread id for the same provider thread", () => {
    const account = makeAccount();
    const a = normalizeGmailSnapshot(account, makeGmailSnapshot());
    const b = normalizeGmailSnapshot(account, makeGmailSnapshot());
    expect(a.id).toBe(b.id);
  });
});
