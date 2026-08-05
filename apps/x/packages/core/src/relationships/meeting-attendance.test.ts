import { describe, expect, it } from "vitest";
import type { MeetingSessionMeta } from "@x/shared/dist/meetings.js";
import type { AttendeeSource } from "../meetings/attendees.js";
import { buildMeetingRoster, resolveRosterBinding } from "../meetings/roster.js";
import { meetingAttendanceObservation } from "./meeting-evidence.js";
import { relationshipObservationKey } from "./evidence-outbox.js";

const SELF = ["me@mycorp.com"];

const meta: MeetingSessionMeta = {
  schema: 1,
  started: "2026-08-04T12:00:00.000Z",
  ended: "2026-08-04T12:30:00.000Z",
  duration_seconds: 1_800,
  audio: { sample_rate: 16_000, channels: 1, encoding: "pcm_s16le", container: "wav" },
  tracks: [],
  warnings: [],
  calendar_event: JSON.stringify({ summary: "Acme check-in" }),
};

const groupInvite: AttendeeSource = {
  attendees: [
    { email: "me@mycorp.com", self: true },
    { email: "ava@acme.com", displayName: "Ava", responseStatus: "accepted" },
    { email: "bo@acme.com", displayName: "Bo", responseStatus: "accepted" },
    { email: "cy@acme.com", displayName: "Cy", responseStatus: "declined" },
  ],
  organizer: { email: "ava@acme.com" },
};

function build(event: AttendeeSource = groupInvite) {
  const roster = buildMeetingRoster(event, { selfEmails: SELF })!;
  const binding = resolveRosterBinding(roster);
  if (binding.kind !== "single_domain" && binding.kind !== "explicit") {
    throw new Error(`expected a bindable roster, got ${binding.kind}`);
  }
  return { roster, binding };
}

describe("meetingAttendanceObservation", () => {
  it("publishes a group meeting that would otherwise be silent", () => {
    const { roster, binding } = build();
    const observation = meetingAttendanceObservation({
      sessionId: "2026.08.04-1200",
      meta,
      roster,
      binding,
    });

    expect(observation.source).toBe("meeting");
    expect(observation.eventType).toBe("meeting_attendance_recorded");
    expect(observation.accountDomain).toBe("acme.com");
    expect(observation.participants?.map((p) => p.email)).toEqual([
      "ava@acme.com",
      "bo@acme.com",
    ]);
  });

  it("never publishes someone who declined", () => {
    const { roster, binding } = build();
    const observation = meetingAttendanceObservation({
      sessionId: "s1",
      meta,
      roster,
      binding,
    });
    expect(observation.participants?.map((p) => p.email)).not.toContain("cy@acme.com");
    expect(observation.normalizedFacts?.declined_count).toBe(1);
  });

  it("carries no payload at all", () => {
    const { roster, binding } = build();
    const observation = meetingAttendanceObservation({
      sessionId: "s1",
      meta,
      roster,
      binding,
    });
    // Payload is the sealed channel that carries transcript text; attendance must
    // never touch it.
    expect(observation.payload).toBeUndefined();
  });

  it("does not turn the calendar organizer into a relationship role", () => {
    const { roster, binding } = build();
    const observation = meetingAttendanceObservation({
      sessionId: "s1",
      meta,
      roster,
      binding,
    });
    expect(observation.participants?.every((p) => p.role === "contact")).toBe(true);
    expect(observation.normalizedFacts?.organizer_email).toBe("ava@acme.com");
  });

  it("prefers the calendar event id and falls back to the session id", () => {
    const { roster, binding } = build();
    const withEvent = meetingAttendanceObservation({
      sessionId: "s1",
      calendarEventId: "evt_9",
      meta,
      roster,
      binding,
    });
    const withoutEvent = meetingAttendanceObservation({
      sessionId: "s1",
      meta,
      roster,
      binding,
    });
    expect(withEvent.externalId).toBe("meeting-attendance:evt_9");
    expect(withoutEvent.externalId).toBe("meeting-attendance:s1");
  });

  it("cannot collide with the same session's transcript observation", () => {
    const { roster, binding } = build();
    const attendance = meetingAttendanceObservation({
      sessionId: "s1",
      meta,
      roster,
      binding,
    });
    // The transcript path keys on `oppulence:<sessionId>`; distinct namespaces mean
    // the two can never dedupe each other away.
    expect(attendance.externalId).not.toBe("oppulence:s1");
    expect(attendance.externalId.startsWith("meeting-attendance:")).toBe(true);
  });

  it("is idempotent for an unchanged invite and versions when someone is added", () => {
    const first = build();
    const a = meetingAttendanceObservation({
      sessionId: "s1",
      meta,
      roster: first.roster,
      binding: first.binding,
    });
    const b = meetingAttendanceObservation({
      sessionId: "s1",
      meta,
      roster: first.roster,
      binding: first.binding,
    });
    expect(relationshipObservationKey(a)).toBe(relationshipObservationKey(b));

    const grown = build({
      ...groupInvite,
      attendees: [
        ...(groupInvite.attendees ?? []),
        { email: "dee@acme.com", displayName: "Dee", responseStatus: "accepted" },
      ],
    });
    const c = meetingAttendanceObservation({
      sessionId: "s1",
      meta,
      roster: grown.roster,
      binding: grown.binding,
    });
    expect(relationshipObservationKey(c)).not.toBe(relationshipObservationKey(a));
  });

  it("uses the user's explicit account choice over any inference", () => {
    const roster = buildMeetingRoster(groupInvite, { selfEmails: SELF })!;
    const target = {
      relationshipId: "11111111-1111-4111-8111-111111111111",
      displayName: "Acme Corporation",
      accountDomain: "acme.com",
    };
    const binding = resolveRosterBinding(roster, { relationshipTarget: target });
    expect(binding.kind).toBe("explicit");

    const observation = meetingAttendanceObservation({
      sessionId: "s1",
      meta,
      roster,
      binding: binding as Extract<typeof binding, { kind: "explicit" }>,
    });
    expect(observation.relationshipId).toBe(target.relationshipId);
    expect(observation.displayName).toBe("Acme Corporation");
  });

  it("records why the roster should be distrusted", () => {
    const { roster, binding } = build();
    const observation = meetingAttendanceObservation({
      sessionId: "s1",
      meta,
      roster,
      binding,
    });
    const caveats = observation.normalizedFacts?.capture_caveats as string[];
    expect(caveats.join(" ")).toMatch(/derived from the calendar invite/);
    expect(observation.normalizedFacts?.attendance_source).toBe("calendar_invite");
  });
});
