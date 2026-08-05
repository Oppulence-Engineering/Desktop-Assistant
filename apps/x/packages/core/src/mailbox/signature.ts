import { stripGmailQuotedReplyText } from "../knowledge/sync_gmail.js";
import { organizationDomain } from "@x/shared/dist/email-domain.js";
import type { MailboxParticipant } from "./types.js";

/**
 * Deterministic email-signature parsing.
 *
 * A signature block is the one place people state their own title and company in a
 * machine-readable-ish way, and it costs nothing to read — no vendor, no egress, no
 * model. But it is a *self-reported claim in free text*, so everything here is
 * deliberately conservative:
 *
 *   - the quoted chain is stripped FIRST, because the classic failure is reading the
 *     previous sender's block and assigning their job title to this contact;
 *   - a title must match a bounded role vocabulary rather than "the line under the
 *     name", which in practice is an address, a pronoun list or a legal disclaimer;
 *   - an organization is accepted only when it corroborates a name we already
 *     associate with that domain — never invented from an arbitrary line;
 *   - confidence never exceeds 0.6, so a signature can lose to a CRM fact or a user
 *     correction without any tie-breaking cleverness.
 */

/** A signature is at the end and it is short. Beyond this it is a document. */
const MAX_BLOCK_LINES = 8;

/** Long enough for "Senior Vice President, Global Partnerships". */
const MAX_TITLE_CHARS = 80;

const BASE_CONFIDENCE = 0.5;
/** Reached once the same (email → title) pair appears in two distinct threads. */
export const CORROBORATED_CONFIDENCE = 0.6;

/** RFC 3676 signature delimiter. */
const DELIMITER = /^-- ?$/;

const ROLE_PATTERN = new RegExp(
  String.raw`\b(` +
    [
      "CEO", "CTO", "COO", "CFO", "CRO", "CMO", "CIO", "CISO",
      "Chief \\w+ Officer",
      "President", "Vice President", "VP", "SVP", "EVP", "AVP",
      "Head of [\\w\\s]+", "Director", "Managing Director",
      "Manager", "Engineer", "Developer", "Designer", "Architect",
      "Founder", "Co-?founder", "Owner", "Partner", "Principal", "Lead",
      "Analyst", "Consultant", "Scientist", "Researcher",
      "Account Executive", "Customer Success \\w+", "Sales \\w+",
    ].join("|") +
    String.raw`)\b`,
  "i",
);

const PHONE_MARKER = /\b(tel|phone|mobile|cell|direct|office|[mpodt])\s*[:.]/i;
const PHONE_PATTERN = /(\+?\d[\d\s().-]{7,}\d)/;
const URL_PATTERN = /https?:\/\/|www\./i;
const LEGAL_NOISE =
  /\b(confidential|disclaimer|unsubscribe|privacy policy|intended recipient|do not reply)\b/i;

export type SignatureBasis =
  | "delimiter_block"
  | "tail_block"
  | "title_line"
  | "org_matches_domain"
  | "phone_marker";

export interface ParsedSignature {
  title?: string;
  organization?: string;
  /**
   * Local only. Never published as relationship evidence: it is PII with no
   * relationship dimension to land in.
   */
  phone?: string;
  /** 0…1, capped at CORROBORATED_CONFIDENCE. */
  confidence: number;
  /** Which rules fired. Travels with the assertion as its reason. */
  basis: SignatureBasis[];
}

function nameTokens(participant: MailboxParticipant): string[] {
  return (participant.name ?? "")
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 2);
}

/**
 * Locate the signature block: an explicit `-- ` delimiter, else a short tail run
 * that mentions the sender's own name.
 */
function locateBlock(
  lines: string[],
  participant: MailboxParticipant,
): { block: string[]; basis: SignatureBasis } | null {
  for (let index = lines.length - 1; index >= 0; index--) {
    if (DELIMITER.test(lines[index].trimEnd())) {
      return { block: lines.slice(index + 1, index + 1 + MAX_BLOCK_LINES), basis: "delimiter_block" };
    }
  }

  const tokens = nameTokens(participant);
  if (tokens.length === 0) return null;
  const tail = lines.slice(-MAX_BLOCK_LINES);
  const anchor = tail.findIndex((line) => {
    const lowered = line.toLowerCase();
    return tokens.some((token) => lowered.includes(token));
  });
  if (anchor === -1) return null;
  return { block: tail.slice(anchor), basis: "tail_block" };
}

function normalizeOrg(value: string): string {
  return value
    .replace(/\b(inc|llc|ltd|limited|gmbh|co|corp|corporation|plc|s\.?a\.?)\b\.?/gi, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseEmailSignature(input: {
  body: string;
  from: MailboxParticipant;
  /** Known organization for the sender's domain, when the knowledge index has one. */
  knownOrganization?: string;
}): ParsedSignature | null {
  if (!input.body?.trim()) return null;

  // FIRST. Everything below is wrong if the quoted chain is still attached.
  const own = stripGmailQuotedReplyText(input.body);
  const lines = own.split(/\r?\n/);
  const located = locateBlock(lines, input.from);
  if (!located) return null;

  const basis: SignatureBasis[] = [located.basis];
  const result: ParsedSignature = { confidence: BASE_CONFIDENCE, basis };

  const candidates = located.block
    .map((line) => line.trim())
    .filter((line) => line && !LEGAL_NOISE.test(line));

  for (const line of candidates) {
    if (
      !result.title &&
      line.length <= MAX_TITLE_CHARS &&
      !line.includes("@") &&
      !URL_PATTERN.test(line) &&
      ROLE_PATTERN.test(line)
    ) {
      result.title = line.replace(/^[|•\-–—\s]+|[|•\-–—\s]+$/g, "");
      basis.push("title_line");
    }

    // Only accept an organization that corroborates what we already believe about
    // this domain. Anything else is a guess dressed as a fact.
    if (!result.organization && input.knownOrganization) {
      const known = normalizeOrg(input.knownOrganization);
      if (known && normalizeOrg(line).includes(known)) {
        result.organization = input.knownOrganization;
        basis.push("org_matches_domain");
      }
    }

    if (!result.phone && PHONE_MARKER.test(line)) {
      const match = line.match(PHONE_PATTERN);
      if (match) {
        result.phone = match[1].trim();
        basis.push("phone_marker");
      }
    }
  }

  if (!result.title && !result.organization && !result.phone) return null;
  return result;
}

/**
 * Raise confidence once the same claim has been seen in a second distinct thread.
 * Repetition is the only corroboration available without a vendor, and it is
 * capped: a signature that says it a hundred times is still self-reported.
 */
export function corroboratedConfidence(seenInThreads: number): number {
  return seenInThreads >= 2 ? CORROBORATED_CONFIDENCE : BASE_CONFIDENCE;
}

/** The organization domain a signature implies, if any. Never a public mailbox. */
export function signatureOrganizationDomain(participant: MailboxParticipant): string | undefined {
  return organizationDomain(participant.email);
}
