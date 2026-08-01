import { describe, expect, it } from "vitest";
import { resolveCounterparty } from "./attendees.js";
import { attributionNotice, formatMeetingNote } from "@x/shared/dist/meetings.js";
import { nativeProvenance } from "./note.js";

/**
 * Naming the other side of a meeting.
 *
 * The bar here is not "usually right". A transcript that confidently attributes a
 * sentence to the wrong participant is worse than one that says "Other", because the
 * reader has no way to tell which lines to doubt — so every case that cannot be
 * answered exactly must decline.
 */
describe("resolveCounterparty", () => {
  const me = { email: "me@acme.com", self: true };

  it("names the single counterparty of a 1:1", () => {
    const { counterparty } = resolveCounterparty({
      attendees: [me, { email: "dana@client.com", displayName: "Dana Reyes" }],
    });
    expect(counterparty?.label).toBe("Dana Reyes");
    expect(counterparty?.email).toBe("dana@client.com");
  });

  it("declines on a group call, and says how many", () => {
    const { counterparty, reason, otherAttendees } = resolveCounterparty({
      attendees: [me, { email: "a@x.com" }, { email: "b@x.com" }],
    });
    // One channel, two people. Any name here would be a guess presented as a fact.
    expect(counterparty).toBeNull();
    expect(otherAttendees).toBe(2);
    expect(reason).toContain("2 other participants");
  });

  it("prefers the knowledge index's name and carries its context", () => {
    const { counterparty } = resolveCounterparty(
      { attendees: [me, { email: "DANA@client.com", displayName: "dana" }] },
      {
        people: [
          {
            name: "Dana Reyes",
            email: "dana@client.com",
            organization: "Client Co",
            role: "VP Ops",
          },
        ],
      },
    );
    expect(counterparty?.label).toBe("Dana Reyes");
    expect(counterparty?.organization).toBe("Client Co");
    expect(counterparty?.role).toBe("VP Ops");
  });

  it("matches a known person by alias when the invite only has a nickname", () => {
    const { counterparty } = resolveCounterparty(
      { attendees: [me, { displayName: "Dee" }] },
      { people: [{ name: "Dana Reyes", aliases: ["Dee"] }] },
    );
    expect(counterparty?.label).toBe("Dana Reyes");
  });

  it("ignores rooms and resources, so a 1:1 in a booked room is still a 1:1", () => {
    const { counterparty } = resolveCounterparty({
      attendees: [
        me,
        { email: "dana@client.com", displayName: "Dana Reyes" },
        { email: "room-4b@acme.com", resource: true },
        { email: "rooms.annex@acme.com" },
      ],
    });
    expect(counterparty?.label).toBe("Dana Reyes");
  });

  it("excludes the local user by explicit address as well as by the self flag", () => {
    const { counterparty } = resolveCounterparty(
      { attendees: [{ email: "Me@Acme.com" }, { email: "dana@client.com" }] },
      { selfEmails: ["me@acme.com"] },
    );
    expect(counterparty?.email).toBe("dana@client.com");
  });

  it("declines with a reason when there is nothing to work from", () => {
    expect(resolveCounterparty(undefined).reason).toBe("no calendar event");
    expect(resolveCounterparty({ attendees: [me] }).reason).toBe(
      "no other attendees on the invite",
    );
    expect(resolveCounterparty({ attendees: [me, {}] }).reason).toContain("no name or address");
  });
});

describe("what the note says about attribution", () => {
  it("warns only when several people share the one channel", () => {
    const grouped = nativeProvenance({
      model: "m",
      sessionId: "s",
      systemAudioCaptured: true,
      attributionLimit: "3 other participants — channel-based attribution cannot tell them apart",
    });
    expect(attributionNotice(grouped)).toContain("all 3 other participants appear as **Other**");

    // Named 1:1 — there is nothing to warn about.
    const named = nativeProvenance({
      model: "m",
      sessionId: "s",
      systemAudioCaptured: true,
      counterparty: { label: "Dana Reyes", email: "dana@client.com" },
    });
    expect(attributionNotice(named)).toBeNull();
    expect(named.counterparty).toBe("Dana Reyes");
    expect(named.speaker_attribution).toBe("named (1:1)");

    // Solo recording — no counterparty at all, so no caveat.
    expect(
      attributionNotice(
        nativeProvenance({
          model: "m",
          sessionId: "s",
          systemAudioCaptured: false,
          attributionLimit: "no other attendees on the invite",
        }),
      ),
    ).toBeNull();
  });

  it("puts the caveat in the note body where Other is actually read", () => {
    const note = formatMeetingNote(
      [{ speaker: "Other", text: "hello" }],
      "2026-07-29T10:00:00.000Z",
      undefined,
      nativeProvenance({
        model: "m",
        sessionId: "s",
        systemAudioCaptured: true,
        attributionLimit: "4 other participants — channel-based attribution cannot tell them apart",
      }),
    );
    expect(note).toContain("appear as **Other**");
  });
});
