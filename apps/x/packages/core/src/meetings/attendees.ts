/**
 * Structurally typed rather than tied to `MeetingCalendarEvent`, so this works on both
 * the slice stored in `meta.json` and a raw provider event straight off disk.
 */
export interface AttendeeRecord {
  email?: string;
  displayName?: string;
  self?: boolean;
  resource?: boolean;
  optional?: boolean;
  responseStatus?: string;
}

export interface AttendeeSource {
  attendees?: AttendeeRecord[];
  organizer?: { email?: string; displayName?: string };
}

/** Why an invitee is not counted as a participant in the conversation. */
export type AttendeeExclusion = "self" | "resource" | "room" | "bot";

export interface AttendeePartition {
  /** The local user, as the invite identifies them. */
  self: AttendeeRecord[];
  /** Everyone else who is a person. */
  others: AttendeeRecord[];
  excluded: { attendee: AttendeeRecord; why: AttendeeExclusion }[];
}

/**
 * Invitees that are attendees to the calendar but not to the conversation.
 *
 * Only consulted when a caller explicitly opts in. See the warning on
 * {@link partitionAttendees} for why this must never apply to attribution.
 */
const BOT_ATTENDEE_PATTERNS: readonly RegExp[] = [
  /^(no-?reply|notetaker|notes|recorder|meeting-?bot|calendar)[-.@]/i,
  /@(fireflies\.ai|otter\.ai|read\.ai|fathom\.video|granola\.(ai|so)|avoma\.com|chorus\.ai|gong\.io)$/i,
  /@(group|resource)\.calendar\.google\.com$/i,
];

/**
 * Who "Other" actually is.
 *
 * Dual-track capture attributes by *channel*, not by voice: everything that came out of
 * the speakers is one bucket. On a 1:1 that bucket has exactly one occupant and the
 * calendar already tells us their name, so calling them "Other" is throwing away an
 * answer we hold. On a four-person call the bucket has three, and there is no honest way
 * to split them — so it stays "Other".
 *
 * That asymmetry is the whole module. The temptation is to name the most likely person
 * and accept being wrong sometimes; a transcript that confidently attributes a sentence
 * to the wrong participant is worse than one that declines to guess, because the reader
 * has no way to tell which lines to doubt.
 */

export interface Counterparty {
  /** What to show in place of "Other". */
  label: string;
  email?: string;
  /** Extra context from the knowledge index, when there is any. */
  organization?: string;
  role?: string;
  /** Exact shared-model destination chosen by the user, when available. */
  relationshipId?: string;
  accountDomain?: string;
}

export interface CounterpartyResolution {
  counterparty: Counterparty | null;
  /** How many people other than the local user were invited. */
  otherAttendees: number;
  /** Why the counterparty is unnamed. Absent when one was resolved. */
  reason?: string;
}

/** The knowledge index's people, narrowed to what matters here. */
export interface KnownPerson {
  name: string;
  email?: string;
  aliases?: string[];
  organization?: string;
  role?: string;
}

function normalizeEmail(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || undefined;
}

/**
 * Split an invite into the local user, the other humans, and everything that is an
 * attendee to the calendar but not to the conversation.
 *
 * ⚠️ `opts.excludeBots` is OFF by default and must stay off for attribution. Bot
 * filtering can only ever *reduce* the other-attendee count, and reducing it from two
 * to one is exactly how {@link resolveCounterparty} would start naming someone it
 * should have declined to name. A roster may turn it on, because dropping a notetaker
 * from "who was in the meeting" cannot mislabel a sentence.
 */
export function partitionAttendees(
  event: AttendeeSource,
  selfEmails: Set<string>,
  opts: { excludeBots?: boolean } = {},
): AttendeePartition {
  const partition: AttendeePartition = { self: [], others: [], excluded: [] };
  for (const attendee of event.attendees ?? []) {
    const email = normalizeEmail(attendee.email);
    if (attendee.self || (email && selfEmails.has(email))) {
      partition.self.push(attendee);
      partition.excluded.push({ attendee, why: "self" });
      continue;
    }
    if (attendee.resource) {
      partition.excluded.push({ attendee, why: "resource" });
      continue;
    }
    // Conference-room invitees are attendees to the calendar and not to the
    // conversation; counting them turns a 1:1 into a "group call" and silently
    // suppresses naming.
    if (email && /^(room|rooms|resource)[-.]|@resource\./.test(email)) {
      partition.excluded.push({ attendee, why: "room" });
      continue;
    }
    if (opts.excludeBots && email && BOT_ATTENDEE_PATTERNS.some((re) => re.test(email))) {
      partition.excluded.push({ attendee, why: "bot" });
      continue;
    }
    partition.others.push(attendee);
  }
  return partition;
}

/** Real people, excluding the local user and anything that looks like a room. */
function humanAttendees(event: AttendeeSource, selfEmails: Set<string>): AttendeeRecord[] {
  return partitionAttendees(event, selfEmails).others;
}

function lookup(people: KnownPerson[], email?: string, displayName?: string): KnownPerson | null {
  const target = normalizeEmail(email);
  if (target) {
    const byEmail = people.find((person) => normalizeEmail(person.email) === target);
    if (byEmail) return byEmail;
  }
  const name = displayName?.trim().toLowerCase();
  if (!name) return null;
  return (
    people.find(
      (person) =>
        person.name.trim().toLowerCase() === name ||
        person.aliases?.some((alias) => alias.trim().toLowerCase() === name),
    ) ?? null
  );
}

/**
 * Resolve the single counterparty of a meeting, or explain why there isn't one.
 *
 * Declining is a normal outcome, not a failure: no calendar event, a solo event, or
 * more than one other participant all legitimately yield `null`.
 */
export function resolveCounterparty(
  event: AttendeeSource | undefined,
  opts: { people?: KnownPerson[]; selfEmails?: string[] } = {},
): CounterpartyResolution {
  if (!event) return { counterparty: null, otherAttendees: 0, reason: "no calendar event" };

  const selfEmails = new Set(
    (opts.selfEmails ?? []).map(normalizeEmail).filter((value): value is string => !!value),
  );
  const others = humanAttendees(event, selfEmails);

  if (others.length === 0) {
    return { counterparty: null, otherAttendees: 0, reason: "no other attendees on the invite" };
  }
  if (others.length > 1) {
    // The honest limit. One channel, several people — any name here would be a guess
    // presented as a fact.
    return {
      counterparty: null,
      otherAttendees: others.length,
      reason: `${others.length} other participants — channel-based attribution cannot tell them apart`,
    };
  }

  const [only] = others;
  const known = lookup(opts.people ?? [], only.email, only.displayName);
  const label = known?.name || only.displayName?.trim() || only.email?.trim();
  if (!label) {
    return {
      counterparty: null,
      otherAttendees: 1,
      reason: "the other attendee has no name or address on the invite",
    };
  }

  return {
    counterparty: {
      label,
      email: normalizeEmail(only.email) ?? normalizeEmail(known?.email),
      organization: known?.organization,
      role: known?.role,
    },
    otherAttendees: 1,
  };
}
