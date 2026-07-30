/**
 * Structurally typed rather than tied to `MeetingCalendarEvent`, so this works on both
 * the slice stored in `meta.json` and a raw provider event straight off disk.
 */
export interface AttendeeSource {
  attendees?: {
    email?: string;
    displayName?: string;
    self?: boolean;
    resource?: boolean;
    responseStatus?: string;
  }[];
  organizer?: { email?: string; displayName?: string };
}

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

/** Real people, excluding the local user and anything that looks like a room or a bot. */
function humanAttendees(
  event: AttendeeSource,
  selfEmails: Set<string>,
): { email?: string; displayName?: string; responseStatus?: string }[] {
  return (event.attendees ?? []).filter((attendee) => {
    if (attendee.self) return false;
    if (attendee.resource) return false;
    const email = normalizeEmail(attendee.email);
    if (email && selfEmails.has(email)) return false;
    // Conference-room and notetaker-bot invitees are attendees to the calendar and not
    // to the conversation; counting them turns a 1:1 into a "group call" and silently
    // suppresses naming.
    if (email && /^(room|rooms|resource)[-.]|@resource\./.test(email)) return false;
    return true;
  });
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
