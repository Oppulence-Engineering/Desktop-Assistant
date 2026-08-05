import { describe, expect, it } from "vitest";
import type { AttendeeSource, KnownPerson } from "./attendees.js";
import { resolveCounterparty } from "./attendees.js";
import { buildMeetingRoster, resolveRosterBinding } from "./roster.js";

const SELF = ["me@mycorp.com"];

function invite(
  attendees: AttendeeSource["attendees"],
  organizer?: { email?: string; displayName?: string },
): AttendeeSource {
  return { attendees, ...(organizer ? { organizer } : {}) };
}

function roster(event: AttendeeSource, people?: KnownPerson[]) {
  return buildMeetingRoster(event, { selfEmails: SELF, ...(people ? { people } : {}) });
}

describe("buildMeetingRoster", () => {
  it("is null without a calendar event", () => {
    expect(buildMeetingRoster(undefined, { selfEmails: SELF })).toBeNull();
  });

  it("resolves a 1:1", () => {
    const built = roster(
      invite([{ email: "me@mycorp.com", self: true }, { email: "ava@acme.com", displayName: "Ava" }]),
    );
    expect(built?.size).toBe("one_to_one");
    expect(built?.external.map((p) => p.displayName)).toEqual(["Ava"]);
    expect(built?.externalDomains).toEqual([{ domain: "acme.com", count: 1 }]);
  });

  it("keeps a whole group from one company together", () => {
    const built = roster(
      invite([
        { email: "me@mycorp.com", self: true },
        { email: "ava@acme.com", displayName: "Ava", responseStatus: "accepted" },
        { email: "bo@acme.com", displayName: "Bo", responseStatus: "accepted" },
        { email: "cy@acme.com", displayName: "Cy", responseStatus: "accepted" },
      ]),
    );
    expect(built?.size).toBe("small_group");
    expect(built?.external).toHaveLength(3);
    expect(built?.externalDomains).toEqual([{ domain: "acme.com", count: 3 }]);
  });

  it("never records someone who declined as a participant", () => {
    const built = roster(
      invite([
        { email: "me@mycorp.com", self: true },
        { email: "ava@acme.com", displayName: "Ava", responseStatus: "accepted" },
        { email: "bo@acme.com", displayName: "Bo", responseStatus: "declined" },
      ]),
    );
    expect(built?.external.map((p) => p.email)).toEqual(["ava@acme.com"]);
    expect(built?.declined.map((p) => p.email)).toEqual(["bo@acme.com"]);
    expect(built?.externalDomains).toEqual([{ domain: "acme.com", count: 1 }]);
    expect(built?.caveats.join(" ")).toMatch(/1 invitee\(s\) declined/);
  });

  it("scores an accepted invitee above an unanswered one", () => {
    const built = roster(
      invite([
        { email: "ava@acme.com", displayName: "Ava", responseStatus: "accepted" },
        { email: "bo@acme.com", displayName: "Bo", responseStatus: "needsAction" },
        { email: "cy@acme.com", displayName: "Cy" },
      ]),
    );
    const byEmail = Object.fromEntries(
      (built?.external ?? []).map((p) => [p.email, p.attendanceConfidence]),
    );
    expect(byEmail["ava@acme.com"]).toBe(0.9);
    expect(byEmail["bo@acme.com"]).toBe(0.6);
    expect(byEmail["cy@acme.com"]).toBe(0.6);
    expect(built?.caveats.join(" ")).toMatch(/had not accepted/);
  });

  it("drops rooms and notetaker bots, and says so", () => {
    const built = roster(
      invite([
        { email: "me@mycorp.com", self: true },
        { email: "ava@acme.com", displayName: "Ava" },
        { email: "room-boardroom@mycorp.com", displayName: "Boardroom" },
        { email: "notetaker@fireflies.ai", displayName: "Fireflies" },
        { email: "big-room@resource.calendar.google.com", resource: true },
      ]),
    );
    expect(built?.size).toBe("one_to_one");
    expect(built?.external.map((p) => p.email)).toEqual(["ava@acme.com"]);
    expect(built?.caveats.join(" ")).toMatch(/3 invitee\(s\) excluded/);
  });

  it("treats colleagues as internal, not as an account", () => {
    const built = roster(
      invite([
        { email: "me@mycorp.com", self: true },
        { email: "peer@mycorp.com", displayName: "Peer" },
      ]),
    );
    expect(built?.external).toHaveLength(1);
    expect(built?.externalDomains).toEqual([]);
  });

  it("contributes no domain for a public mailbox", () => {
    const built = roster(
      invite([{ email: "me@mycorp.com", self: true }, { email: "someone@gmail.com", displayName: "S" }]),
    );
    expect(built?.external).toHaveLength(1);
    expect(built?.externalDomains).toEqual([]);
  });

  it("refuses an invite that is really a distribution list", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      email: `p${i}@acme.com`,
      displayName: `P${i}`,
    }));
    expect(buildMeetingRoster(invite(many), { selfEmails: SELF })).toBeNull();
  });

  it("prefers a canonical name from the knowledge index", () => {
    const built = roster(invite([{ email: "ava@acme.com", displayName: "ava (external)" }]), [
      { name: "Ava Stone", email: "ava@acme.com", organization: "Acme" },
    ]);
    expect(built?.external[0].displayName).toBe("Ava Stone");
  });

  it("marks the organizer without turning that into a role", () => {
    const built = roster(
      invite(
        [
          { email: "ava@acme.com", displayName: "Ava" },
          { email: "bo@acme.com", displayName: "Bo" },
        ],
        { email: "ava@acme.com" },
      ),
    );
    expect(built?.organizerEmail).toBe("ava@acme.com");
    expect(built?.external.find((p) => p.email === "ava@acme.com")?.organizer).toBe(true);
  });

  it("fingerprints the same invite identically regardless of order", () => {
    const a = roster(
      invite([
        { email: "ava@acme.com", displayName: "Ava", responseStatus: "accepted" },
        { email: "bo@acme.com", displayName: "Bo", responseStatus: "accepted" },
      ]),
    );
    const b = roster(
      invite([
        { email: "bo@acme.com", displayName: "Bo", responseStatus: "accepted" },
        { email: "ava@acme.com", displayName: "Ava", responseStatus: "accepted" },
      ]),
    );
    expect(a?.fingerprint).toBe(b?.fingerprint);
  });

  it("changes the fingerprint when someone is added", () => {
    const before = roster(invite([{ email: "ava@acme.com", displayName: "Ava" }]));
    const after = roster(
      invite([
        { email: "ava@acme.com", displayName: "Ava" },
        { email: "bo@acme.com", displayName: "Bo" },
      ]),
    );
    expect(before?.fingerprint).not.toBe(after?.fingerprint);
  });
});

describe("resolveRosterBinding", () => {
  const target = {
    relationshipId: "11111111-1111-4111-8111-111111111111",
    displayName: "Acme",
  };

  it("lets an explicit user choice win over everything", () => {
    const built = roster(
      invite([
        { email: "ava@acme.com", displayName: "Ava" },
        { email: "zed@globex.com", displayName: "Zed" },
      ]),
    )!;
    expect(resolveRosterBinding(built, { relationshipTarget: target })).toEqual({
      kind: "explicit",
      target,
    });
  });

  it("binds a single external organization", () => {
    const built = roster(
      invite([
        { email: "me@mycorp.com", self: true },
        { email: "ava@acme.com", displayName: "Ava" },
        { email: "bo@acme.com", displayName: "Bo" },
      ]),
    )!;
    expect(resolveRosterBinding(built)).toEqual({
      kind: "single_domain",
      accountDomain: "acme.com",
      displayName: "acme.com",
    });
  });

  it("names the organization when the knowledge index knows it", () => {
    const people: KnownPerson[] = [
      { name: "Ava", email: "ava@acme.com", organization: "Acme Corporation" },
    ];
    const built = roster(invite([{ email: "ava@acme.com", displayName: "Ava" }]), people)!;
    expect(resolveRosterBinding(built, { people })).toMatchObject({
      kind: "single_domain",
      displayName: "Acme Corporation",
    });
  });

  /** The whole reason this exists: a wrong domain becomes a sticky durable anchor. */
  it("refuses to guess across two organizations", () => {
    const built = roster(
      invite([
        { email: "me@mycorp.com", self: true },
        { email: "ava@acme.com", displayName: "Ava" },
        { email: "bo@acme.com", displayName: "Bo" },
        { email: "zed@globex.com", displayName: "Zed" },
      ]),
    )!;
    const binding = resolveRosterBinding(built);
    expect(binding.kind).toBe("ambiguous");
    // The majority domain is offered as a candidate, never chosen.
    expect(binding).toMatchObject({
      candidates: [
        { domain: "acme.com", count: 2 },
        { domain: "globex.com", count: 1 },
      ],
    });
  });

  it("collapses to one organization when the extra domains are personal", () => {
    const built = roster(
      invite([
        { email: "me@mycorp.com", self: true },
        { email: "ava@acme.com", displayName: "Ava" },
        { email: "ava.personal@gmail.com", displayName: "Ava (personal)" },
      ]),
    )!;
    expect(resolveRosterBinding(built)).toMatchObject({
      kind: "single_domain",
      accountDomain: "acme.com",
    });
  });

  it("publishes nothing for an all-internal meeting", () => {
    const built = roster(
      invite([
        { email: "me@mycorp.com", self: true },
        { email: "peer@mycorp.com", displayName: "Peer" },
      ]),
    )!;
    expect(resolveRosterBinding(built)).toEqual({ kind: "internal_only" });
  });

  it("is unresolvable with no external participants", () => {
    const built = roster(invite([{ email: "me@mycorp.com", self: true }]))!;
    expect(resolveRosterBinding(built).kind).toBe("unresolvable");
  });
});

/**
 * The guard on the entire change. Attribution must be untouched by any of the above:
 * a roster may exclude bots and name a group, and `resolveCounterparty` must keep
 * declining exactly when it declined before.
 */
describe("attribution is unchanged by roster support", () => {
  it("still declines a group even though the roster can name it", () => {
    const event = invite([
      { email: "me@mycorp.com", self: true },
      { email: "ava@acme.com", displayName: "Ava" },
      { email: "bo@acme.com", displayName: "Bo" },
    ]);
    const resolution = resolveCounterparty(event, { selfEmails: SELF });
    expect(resolution.counterparty).toBeNull();
    expect(resolution.otherAttendees).toBe(2);
    expect(roster(event)?.external).toHaveLength(2);
  });

  /**
   * The trap: if bot filtering ever reached attribution, this two-person call would
   * look like a 1:1 and the transcript would confidently name the wrong person.
   */
  it("does not let bot filtering turn a group into a 1:1 for attribution", () => {
    const event = invite([
      { email: "me@mycorp.com", self: true },
      { email: "ava@acme.com", displayName: "Ava" },
      { email: "notetaker@otter.ai", displayName: "Otter" },
    ]);
    const resolution = resolveCounterparty(event, { selfEmails: SELF });
    expect(resolution.counterparty).toBeNull();
    expect(resolution.otherAttendees).toBe(2);
    // The roster may still drop the bot; only attribution must stay conservative.
    expect(roster(event)?.external.map((p) => p.email)).toEqual(["ava@acme.com"]);
  });

  it("still names a genuine 1:1", () => {
    const event = invite([
      { email: "me@mycorp.com", self: true },
      { email: "ava@acme.com", displayName: "Ava" },
    ]);
    expect(resolveCounterparty(event, { selfEmails: SELF }).counterparty?.label).toBe("Ava");
  });
});
