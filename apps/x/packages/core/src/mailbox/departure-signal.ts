/**
 * Reading departures out of bounces and autoresponders.
 *
 * When a contact leaves a company, the mail system usually says so — a hard
 * bounce naming an unknown recipient, or an autoreply that begins "I am no
 * longer with". The desktop already receives these and throws them away:
 * `isMachineSender` classifies `mailer-daemon`, `postmaster` and `bounce` as
 * systems rather than people, and nothing downstream looks at them again.
 *
 * That discarded signal is the cheapest and most reliable departure evidence
 * available. It arrives unprompted, it is first-party, it costs nothing, and it
 * is far more definitive than inferring absence from silence — a quiet contact
 * may be on holiday, but a 5.1.1 on a former colleague's address is a fact.
 *
 * This module only reads. It returns a signal and never decides what happens
 * next, because "this address is dead" and "this person left the company" are
 * different claims and only the first is established here. A mistyped address
 * bounces identically to a departed one.
 */

/** How confident the mail system's own words make us. */
export type DepartureSignalKind =
  /** The bounce or autoreply says in words that the person has left. */
  | "left_organization"
  /** A permanent delivery failure: the mailbox does not exist any more. */
  | "recipient_unknown";

export interface DepartureSignal {
  /** The address that could not be reached, lowercased. */
  email: string;
  kind: DepartureSignalKind;
  /**
   * What the mail system actually said, trimmed. Kept so a person reviewing the
   * signal can judge it rather than trusting a classifier — a bounce is
   * evidence, and evidence a user cannot read is just an assertion.
   */
  evidence: string;
}

/** Envelope senders that emit delivery reports. */
const BOUNCE_SENDER = /^(mailer-daemon|postmaster|bounce[sd]?)\b/i;

/** Subjects delivery reports use, across the common providers. */
const BOUNCE_SUBJECT =
  /(undeliverable|delivery status notification|returned mail|delivery failure|mail delivery failed|address not found)/i;

/**
 * Permanent-failure phrasing. Deliberately excludes anything transient — a full
 * mailbox, a greylist, a server that was briefly down. Those recover, and
 * treating them as a departure would retire live contacts on an outage.
 */
const PERMANENT_FAILURE =
  /(\b5\.1\.[0123]\b|550[ -]|user unknown|no such user|recipient (address )?rejected|address not found|mailbox (is )?unavailable|does not exist|account (has been )?(disabled|deactivated|closed))/i;

/**
 * Wording that names a departure outright — the strong case, where a human
 * sentence says the person is gone.
 *
 * Split by grammatical person, because who is speaking decides who the signal is
 * about. "I have left the company" is an autoreply from the departed address.
 * "Sarah has left the company" is a colleague telling you about someone else,
 * and attributing that to the sender would retire the person who is still there
 * — the most damaging false positive available here.
 */
const LEFT_FIRST_PERSON =
  /\b(i|i've|i have)\b[^.\n]{0,60}\b(no longer (with|work(s|ing)? (at|for))|have left|has left|am no longer|left the (company|organi[sz]ation|firm))/i;

const LEFT_THIRD_PERSON =
  /(no longer (with|works? (at|for)|employed)|has (since )?left (the (company|organi[sz]ation|firm))?|is no longer (here|at)|departed the (company|organi[sz]ation)|last day (was|at))/i;

/** Transient conditions that must never read as a departure. */
const TRANSIENT_FAILURE =
  /(\b4\.\d\.\d\b|mailbox (is )?full|over quota|quota exceeded|temporarily unavailable|try again later|greylist)/i;

const EMAIL_IN_TEXT = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

function firstEmailIn(text: string, exclude: ReadonlySet<string>): string | null {
  const matches = text.match(EMAIL_IN_TEXT);
  if (!matches) return null;
  for (const raw of matches) {
    const email = raw.toLowerCase().replace(/[.,;:]+$/, "");
    // Skip the reporting system itself and the user's own addresses; the failed
    // recipient is the one address in the report that is neither.
    if (exclude.has(email)) continue;
    if (BOUNCE_SENDER.test(email.split("@")[0] ?? "")) continue;
    return email;
  }
  return null;
}

export interface DepartureCandidateMessage {
  from?: string;
  subject?: string;
  body?: string;
}

/**
 * Read a departure signal out of one message, or null if it is not one.
 *
 * `selfEmails` are the user's own addresses, excluded when locating the failed
 * recipient inside a delivery report.
 */
export function detectDepartureSignal(
  message: DepartureCandidateMessage,
  selfEmails: ReadonlySet<string>,
): DepartureSignal | null {
  const from = (message.from ?? "").toLowerCase();
  const subject = message.subject ?? "";
  const body = message.body ?? "";
  const haystack = `${subject}\n${body}`;

  // A transient failure is not a departure, and checking first means no amount
  // of permanent-sounding boilerplate elsewhere in the report can override it.
  if (TRANSIENT_FAILURE.test(haystack)) return null;

  const fromLocal = from.includes("@") ? from.slice(0, from.indexOf("@")) : from;
  const looksLikeBounce = BOUNCE_SENDER.test(fromLocal) || BOUNCE_SUBJECT.test(subject);

  const excluded = new Set<string>([...selfEmails].map((e) => e.toLowerCase()));

  // Strongest case: a sentence says the person left. Attribution depends on who
  // is speaking.
  const firstPerson = haystack.match(LEFT_FIRST_PERSON);
  if (firstPerson) {
    // An autoreply speaks *as* the departed address, so the sender is the
    // subject.
    const sender = from.match(EMAIL_IN_TEXT)?.[0]?.toLowerCase() ?? null;
    if (!sender || excluded.has(sender)) return null;
    return {
      email: sender,
      kind: "left_organization",
      evidence: sentenceAround(haystack, firstPerson.index ?? 0),
    };
  }

  const thirdPerson = haystack.match(LEFT_THIRD_PERSON);
  if (thirdPerson) {
    // Someone is telling you about a third party. Only usable if the text names
    // an address — otherwise we know a departure happened and not whose, and a
    // guess would retire the messenger.
    const named = firstEmailIn(haystack, excluded);
    const sender = from.match(EMAIL_IN_TEXT)?.[0]?.toLowerCase() ?? null;
    if (!named || named === sender) return null;
    return {
      email: named,
      kind: "left_organization",
      evidence: sentenceAround(haystack, thirdPerson.index ?? 0),
    };
  }

  if (!looksLikeBounce) return null;

  const permanentMatch = haystack.match(PERMANENT_FAILURE);
  if (!permanentMatch) return null;

  const email = firstEmailIn(haystack, excluded);
  if (!email) return null;

  return {
    email,
    kind: "recipient_unknown",
    evidence: sentenceAround(haystack, permanentMatch.index ?? 0),
  };
}

/** A readable slice around a match, so the evidence is a sentence not a token. */
function sentenceAround(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf("\n", index) + 1);
  const newlineEnd = text.indexOf("\n", index);
  const end = newlineEnd === -1 ? text.length : newlineEnd;
  return text.slice(start, Math.min(end, start + 300)).trim();
}
