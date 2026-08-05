import { describe, expect, it } from "vitest";
import { parseEmailSignature, corroboratedConfidence } from "./signature.js";

const from = { name: "Sarah Chen", email: "sarah@acme.com" };

describe("parseEmailSignature", () => {
  it("reads a delimited signature block", () => {
    const parsed = parseEmailSignature({
      body: [
        "Sounds good — talk Thursday.",
        "",
        "-- ",
        "Sarah Chen",
        "VP Engineering",
        "Acme Corporation",
        "m: +1 415 555 0134",
      ].join("\n"),
      from,
      knownOrganization: "Acme Corporation",
    });

    expect(parsed?.title).toBe("VP Engineering");
    expect(parsed?.organization).toBe("Acme Corporation");
    expect(parsed?.phone).toBe("+1 415 555 0134");
    expect(parsed?.basis).toContain("delimiter_block");
  });

  /**
   * The classic failure: without stripping the quoted chain first, the previous
   * sender's block is the last thing in the text and their title gets attached to
   * this contact.
   */
  it("never reads a title out of the quoted chain", () => {
    const parsed = parseEmailSignature({
      body: [
        "Thanks!",
        "",
        "On Mon, Aug 3, 2026 at 9:14 AM Dana Fox <dana@globex.com> wrote:",
        "> Here you go.",
        "> --",
        "> Dana Fox",
        "> Chief Financial Officer",
        "> Globex",
      ].join("\n"),
      from,
      knownOrganization: "Globex",
    });

    expect(parsed?.title).not.toBe("Chief Financial Officer");
    expect(parsed?.organization).not.toBe("Globex");
  });

  it("finds a tail block anchored on the sender's own name", () => {
    const parsed = parseEmailSignature({
      body: ["Will confirm tomorrow.", "", "Sarah Chen", "Head of Platform", "Acme"].join("\n"),
      from,
    });
    expect(parsed?.title).toBe("Head of Platform");
    expect(parsed?.basis).toContain("tail_block");
  });

  it("refuses to invent an organization it cannot corroborate", () => {
    const parsed = parseEmailSignature({
      body: ["-- ", "Sarah Chen", "VP Engineering", "Sent from my iPhone"].join("\n"),
      from,
    });
    expect(parsed?.title).toBe("VP Engineering");
    // No knownOrganization, so no org may be claimed from an arbitrary line.
    expect(parsed?.organization).toBeUndefined();
  });

  it("does not treat an address or a URL as a title", () => {
    const parsed = parseEmailSignature({
      body: ["-- ", "Sarah Chen", "sarah@acme.com", "https://acme.com/team/lead-engineer"].join("\n"),
      from,
    });
    expect(parsed?.title).toBeUndefined();
  });

  it("ignores legal boilerplate", () => {
    const parsed = parseEmailSignature({
      body: [
        "-- ",
        "Sarah Chen",
        "This message is confidential and intended recipient only. Director of nothing.",
      ].join("\n"),
      from,
    });
    expect(parsed?.title).toBeUndefined();
  });

  it("requires a marker before harvesting digits as a phone number", () => {
    const parsed = parseEmailSignature({
      body: ["-- ", "Sarah Chen", "VP Engineering", "Order 4402251 shipped 2026-08-04"].join("\n"),
      from,
    });
    expect(parsed?.phone).toBeUndefined();
  });

  it("returns null when there is no signature at all", () => {
    expect(parseEmailSignature({ body: "ok thanks", from })).toBeNull();
    expect(parseEmailSignature({ body: "", from })).toBeNull();
  });

  it("never reports more than corroborated confidence", () => {
    const parsed = parseEmailSignature({
      body: ["-- ", "Sarah Chen", "VP Engineering"].join("\n"),
      from,
    });
    // A signature is a self-reported claim; it must be able to lose to a CRM
    // fact or a user correction without any tie-breaking.
    expect(parsed?.confidence).toBeLessThanOrEqual(0.6);
    expect(corroboratedConfidence(1)).toBe(0.5);
    expect(corroboratedConfidence(2)).toBe(0.6);
    expect(corroboratedConfidence(50)).toBe(0.6);
  });
});
