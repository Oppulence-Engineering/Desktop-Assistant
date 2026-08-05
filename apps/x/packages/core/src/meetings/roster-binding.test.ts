import { describe, expect, it } from "vitest";
import type { AttendeeSource } from "./attendees.js";
import { buildMeetingRoster, resolveRosterBinding } from "./roster.js";

/**
 * The rules that decide whether an unrecorded calendar meeting publishes anything.
 *
 * `publishCalendarAttendance` reaches the filesystem and the outbox, so the parts
 * worth pinning are these — the same conservative rules a recorded call gets.
 */
const SELF = ["me@mycorp.com"];

function bindingFor(attendees: AttendeeSource["attendees"]) {
  const roster = buildMeetingRoster({ attendees }, { selfEmails: SELF });
  if (!roster) return { kind: "unresolvable" as const, reason: "roster too large" };
  return resolveRosterBinding(roster);
}

describe("what an unrecorded calendar meeting publishes", () => {
  it("publishes a single-organization external meeting", () => {
    expect(
      bindingFor([
        { email: "me@mycorp.com", self: true },
        { email: "ava@acme.com", displayName: "Ava", responseStatus: "accepted" },
        { email: "bo@acme.com", displayName: "Bo", responseStatus: "accepted" },
      ]),
    ).toMatchObject({ kind: "single_domain", accountDomain: "acme.com" });
  });

  it("publishes nothing for a team standup", () => {
    expect(
      bindingFor([
        { email: "me@mycorp.com", self: true },
        { email: "peer@mycorp.com", displayName: "Peer" },
        { email: "lead@mycorp.com", displayName: "Lead" },
      ]),
    ).toEqual({ kind: "internal_only" });
  });

  it("publishes nothing when the invite spans two organizations", () => {
    expect(
      bindingFor([
        { email: "me@mycorp.com", self: true },
        { email: "ava@acme.com", displayName: "Ava" },
        { email: "zed@globex.com", displayName: "Zed" },
      ]).kind,
    ).toBe("ambiguous");
  });

  it("publishes nothing for a solo calendar block", () => {
    expect(bindingFor([{ email: "me@mycorp.com", self: true }]).kind).toBe("unresolvable");
  });

  it("publishes nothing for an all-hands sized invite", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      email: `p${i}@acme.com`,
      displayName: `P${i}`,
    }));
    expect(bindingFor(many).kind).toBe("unresolvable");
  });

  it("excludes someone who declined from the published roster", () => {
    const roster = buildMeetingRoster(
      {
        attendees: [
          { email: "me@mycorp.com", self: true },
          { email: "ava@acme.com", displayName: "Ava", responseStatus: "accepted" },
          { email: "bo@acme.com", displayName: "Bo", responseStatus: "declined" },
        ],
      },
      { selfEmails: SELF },
    )!;
    expect(roster.external.map((p) => p.email)).toEqual(["ava@acme.com"]);
    expect(roster.declined.map((p) => p.email)).toEqual(["bo@acme.com"]);
  });
});
