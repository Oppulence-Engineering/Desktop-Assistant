import { createHash } from "node:crypto";
import type { MeetingRelationshipTarget } from "@x/shared/dist/meetings.js";
import { organizationDomain } from "@x/shared/dist/email-domain.js";
import type { AttendeeRecord, AttendeeSource, KnownPerson } from "./attendees.js";
import { partitionAttendees } from "./attendees.js";

/**
 * Who was in the meeting, as distinct from whose voice is on which track.
 *
 * These are two different claims with two different sources, and conflating them is
 * why a group meeting currently publishes nothing at all:
 *
 *   attribution   "whose voice is this?"    the audio channel   1:1 only
 *   participation "who was in the meeting?" the calendar invite any size
 *
 * `resolveCounterparty` answers the first and correctly refuses anything but a 1:1.
 * This module answers the second, which the invite already states outright. Nothing
 * here feeds attribution, and nothing here may change it.
 */

/** Above this an invite is a distribution list, not a meeting. */
const DEFAULT_MAX_PARTICIPANTS = 25;

const CONFIDENCE_ACCEPTED = 0.9;
/** Invited and not declined, but never confirmed. They may simply not have come. */
const CONFIDENCE_UNCONFIRMED = 0.6;

export type RosterSize = "solo" | "one_to_one" | "small_group" | "large_group";

export interface RosterParticipant {
  displayName: string;
  email?: string;
  /** Undefined for public mailboxes and for attendees with no address. */
  organizationDomain?: string;
  responseStatus?: string;
  optional: boolean;
  organizer: boolean;
  /** How strongly the *invite* supports this person having been present. */
  attendanceConfidence: number;
}

export interface MeetingRoster {
  /** Every human on the invite, the local user included. */
  people: RosterParticipant[];
  /** People other than the local user who did not decline. */
  external: RosterParticipant[];
  /** Invitees who explicitly declined. Never published as participants. */
  declined: RosterParticipant[];
  /** Organization domains among `external`, excluding the user's own, busiest first. */
  externalDomains: { domain: string; count: number }[];
  organizerEmail?: string;
  size: RosterSize;
  /** Everything a reader needs in order to distrust this roster correctly. */
  caveats: string[];
  /** Stable across reorderings; drives the observation's sourceVersion. */
  fingerprint: string;
}

export type RosterBinding =
  | { kind: "explicit"; target: MeetingRelationshipTarget }
  | { kind: "single_domain"; accountDomain: string; displayName: string }
  | { kind: "ambiguous"; candidates: { domain: string; count: number }[] }
  | { kind: "internal_only" }
  | { kind: "unresolvable"; reason: string };

function normalizeEmail(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || undefined;
}

function confidenceFor(responseStatus: string | undefined): number {
  return responseStatus === "accepted" ? CONFIDENCE_ACCEPTED : CONFIDENCE_UNCONFIRMED;
}

function toParticipant(
  attendee: AttendeeRecord,
  organizerEmail: string | undefined,
  people: KnownPerson[],
): RosterParticipant | null {
  const email = normalizeEmail(attendee.email);
  const known = email
    ? people.find((person) => normalizeEmail(person.email) === email)
    : undefined;
  const displayName = known?.name?.trim() || attendee.displayName?.trim() || email;
  // No name and no address is not a person we can name or publish.
  if (!displayName) return null;
  return {
    displayName,
    ...(email ? { email } : {}),
    ...(organizationDomain(email) ? { organizationDomain: organizationDomain(email)! } : {}),
    ...(attendee.responseStatus ? { responseStatus: attendee.responseStatus } : {}),
    optional: attendee.optional === true,
    organizer: !!email && !!organizerEmail && email === organizerEmail,
    attendanceConfidence: confidenceFor(attendee.responseStatus),
  };
}

function sizeOf(externalCount: number): RosterSize {
  if (externalCount === 0) return "solo";
  if (externalCount === 1) return "one_to_one";
  return externalCount <= 8 ? "small_group" : "large_group";
}

/**
 * Build the participation roster for an invite, or null when there is no meaningful
 * one (no calendar event, or an invite so large it is a broadcast).
 */
export function buildMeetingRoster(
  event: AttendeeSource | undefined,
  opts: {
    selfEmails?: string[];
    /** Canonical names from the knowledge index. Main process only. */
    people?: KnownPerson[];
    maxParticipants?: number;
  } = {},
): MeetingRoster | null {
  if (!event) return null;

  const selfEmails = new Set(
    (opts.selfEmails ?? []).map(normalizeEmail).filter((value): value is string => !!value),
  );
  const known = opts.people ?? [];
  const maxParticipants = opts.maxParticipants ?? DEFAULT_MAX_PARTICIPANTS;
  const organizerEmail = normalizeEmail(event.organizer?.email);

  // Bots are excluded here and only here. Removing a notetaker from "who was in the
  // meeting" cannot mislabel a sentence; removing it from attribution can.
  const partition = partitionAttendees(event, selfEmails, { excludeBots: true });
  if (partition.others.length > maxParticipants) return null;

  const others = partition.others
    .map((attendee) => toParticipant(attendee, organizerEmail, known))
    .filter((participant): participant is RosterParticipant => participant !== null);
  const selves = partition.self
    .map((attendee) => toParticipant(attendee, organizerEmail, known))
    .filter((participant): participant is RosterParticipant => participant !== null);

  const declined = others.filter((participant) => participant.responseStatus === "declined");
  const external = others.filter((participant) => participant.responseStatus !== "declined");

  // The user's own organization is not an external account.
  const selfDomains = new Set(
    [...selfEmails].map((email) => organizationDomain(email)).filter((d): d is string => !!d),
  );
  const domainCounts = new Map<string, number>();
  for (const participant of external) {
    const domain = participant.organizationDomain;
    if (!domain || selfDomains.has(domain)) continue;
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }
  const externalDomains = [...domainCounts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    // Ties broken by name so the order — and the fingerprint — is deterministic.
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));

  const excludedNonSelf = partition.excluded.filter((entry) => entry.why !== "self").length;
  const unconfirmed = external.filter((p) => p.responseStatus !== "accepted").length;

  const caveats: string[] = [
    "Attendance is derived from the calendar invite, not from the recording: an invitee may not have joined.",
  ];
  if (external.length > 1) {
    caveats.push(
      `${external.length} participants shared one audio channel; no per-speaker attribution was attempted.`,
    );
  }
  if (excludedNonSelf > 0) {
    caveats.push(
      `${excludedNonSelf} invitee(s) excluded as rooms, resources, or notetaker bots.`,
    );
  }
  if (unconfirmed > 0) {
    caveats.push(`${unconfirmed} of ${external.length} invitee(s) had not accepted at capture time.`);
  }
  if (declined.length > 0) {
    caveats.push(`${declined.length} invitee(s) declined and are not recorded as participants.`);
  }
  if (externalDomains.length > 1) {
    caveats.push(
      `Invitees span ${externalDomains.length} organization domains ` +
        `(${externalDomains.map((d) => d.domain).join(", ")}).`,
    );
  }

  const fingerprintSource = [...external]
    .map((p) => `${p.email ?? p.displayName}:${p.responseStatus ?? ""}`)
    .sort()
    .join("|");

  return {
    people: [...selves, ...others],
    external,
    declined,
    externalDomains,
    ...(organizerEmail ? { organizerEmail } : {}),
    size: sizeOf(external.length),
    caveats,
    fingerprint: createHash("sha256").update(fingerprintSource).digest("hex").slice(0, 32),
  };
}

/**
 * Which relationship a meeting's evidence belongs to.
 *
 * The hard case is a call spanning two organizations, and the answer is deliberately
 * "ask". Majority-domain and organizer-domain heuristics both look reasonable and are
 * both wrong: a partner call, a customer-plus-integrator call and a
 * candidate-plus-recruiter call are indistinguishable on the invite.
 *
 * The backend's ambiguity safety net does not catch this either. It refuses to pick a
 * winner when *several relationships match* an observation, but a domain guessed here
 * arrives as a confident single answer and is bound as a durable anchor — and anchors
 * are sticky and expensive to unwind. One click from the user is cheaper.
 */
export function resolveRosterBinding(
  roster: MeetingRoster,
  opts: {
    relationshipTarget?: MeetingRelationshipTarget;
    people?: KnownPerson[];
  } = {},
): RosterBinding {
  // The operator already answered, and their answer is persisted and audited.
  if (opts.relationshipTarget) {
    return { kind: "explicit", target: opts.relationshipTarget };
  }
  if (roster.external.length === 0) {
    return { kind: "unresolvable", reason: "no external participants on the invite" };
  }
  if (roster.externalDomains.length === 0) {
    // Everyone is a colleague, or everyone is on a personal mailbox. Neither is an
    // account, and inventing one from a personal address would be worse than silence.
    return { kind: "internal_only" };
  }
  if (roster.externalDomains.length > 1) {
    return { kind: "ambiguous", candidates: roster.externalDomains };
  }

  const [{ domain }] = roster.externalDomains;
  const organization = (opts.people ?? []).find(
    (person) => organizationDomain(person.email) === domain && person.organization,
  )?.organization;
  return { kind: "single_domain", accountDomain: domain, displayName: organization ?? domain };
}
