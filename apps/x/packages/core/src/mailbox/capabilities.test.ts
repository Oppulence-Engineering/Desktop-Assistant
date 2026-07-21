import { describe, expect, it } from "vitest";

import { capabilitiesFromScopes, hasCapability } from "./capabilities.js";

describe("capabilitiesFromScopes", () => {
  it("derives the full modify set from gmail.modify", () => {
    const caps = capabilitiesFromScopes("gmail", ["https://www.googleapis.com/auth/gmail.modify"]);
    expect(caps).toEqual(
      expect.arrayContaining(["mail.read", "mail.modify", "mail.send", "mail.draft", "mail.watch"]),
    );
  });

  it("derives read-only capabilities from gmail.readonly", () => {
    const caps = capabilitiesFromScopes("gmail", [
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    expect(hasCapability(caps, "mail.read")).toBe(true);
    expect(hasCapability(caps, "mail.modify")).toBe(false);
    expect(hasCapability(caps, "mail.send")).toBe(false);
  });

  it("ignores unknown scopes without throwing", () => {
    expect(capabilitiesFromScopes("gmail", ["https://example.com/unknown"])).toEqual([]);
  });

  it("maps Microsoft Graph scopes for outlook", () => {
    const caps = capabilitiesFromScopes("outlook", ["Mail.ReadWrite", "Mail.Send"]);
    expect(caps).toEqual(expect.arrayContaining(["mail.read", "mail.modify", "mail.send"]));
  });
});
