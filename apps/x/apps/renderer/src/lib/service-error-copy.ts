import { PRODUCT_NAME } from "@x/shared/dist/branding.js";
// Extension-qualified and relative rather than the "@/lib/..." alias the
// components use: this module is covered by tests/service-error-copy.test.ts,
// which runs under `node --test` with no Vite alias resolution.
import { matchBillingError } from "./billing-error.ts";

/**
 * Who has to do something about a failed background run.
 *
 * The distinction is the whole point: "you are out of credits" and "our model
 * provider is out of credits" both used to surface as the same red machine
 * token, so a user could not tell a problem they can fix from one they can only
 * wait out.
 */
export type ServiceErrorFault = "billing" | "auth" | "provider" | "config" | "unknown";

export type ServiceErrorCopy = {
  /** One sentence, safe to show to someone who has never read our source. */
  text: string;
  fault: ServiceErrorFault;
};

/**
 * Background services log raw gateway codes — `insufficient_credits`,
 * `model_not_allowed`, `upstream_credits_exhausted`. Data health rendered those
 * verbatim, so the panel read as a stack trace and never named the one action
 * that would fix it. Dogfooding on 2026-08-07: every batch failed
 * `insufficient_credits` for hours with an Upgrade button sitting unused a few
 * inches away in the same sidebar.
 *
 * Order matters — the specific codes are tested before the generic upstream
 * ones, because an out-of-credits vendor also carries "upstream" in its code.
 */
const SERVICE_ERROR_PATTERNS: { pattern: RegExp; text: string; fault: ServiceErrorFault }[] = [
  {
    // Ours, not theirs. Saying "you ran out" here would blame the user for an
    // unfunded vendor account they have no way to top up.
    pattern: /upstream_credits_exhausted/i,
    text: `${PRODUCT_NAME}'s model provider is out of credits. This one is on us — no action needed.`,
    fault: "provider",
  },
  {
    pattern: /daily_credit_limit_exceeded|daily credit limit/i,
    text: "Today's credit limit is used up. Background work resumes after it resets at 00:00 UTC.",
    fault: "billing",
  },
  {
    pattern: /monthly_credit_limit_exceeded|monthly credit limit/i,
    text: "This month's credit limit is used up. Upgrade for more usage.",
    fault: "billing",
  },
  {
    pattern: /model_not_allowed/i,
    text: "This model isn't enabled for your account yet.",
    fault: "config",
  },
  {
    pattern: /upstream_rate_limited|rate limit/i,
    text: "The model provider is rate limiting requests. This retries on its own.",
    fault: "provider",
  },
  {
    pattern: /no refresh token/i,
    text: "This account needs to be reconnected before it can sync.",
    fault: "auth",
  },
  {
    // No bare /401/: these run over the whole error text, and a stack trace or
    // a line number would match it by accident.
    pattern: /unauthorized|invalid or expired token/i,
    text: "Your session expired. Sign in again to resume background work.",
    fault: "auth",
  },
  {
    pattern: /upstream_error|bad gateway|\b502\b|provider_unconfigured/i,
    text: "The model provider is unavailable. This retries on its own.",
    fault: "provider",
  },
];

/**
 * Services log whatever they caught, which is regularly a pretty-printed JSON
 * body or a Zod issue array. Taking the first line of those yields "[" or "{".
 * The human part is inside, under "detail" (RFC 9457 problem bodies) or
 * "message" (Zod, and most SDK errors).
 */
const JSON_MESSAGE = /"(?:detail|message)"\s*:\s*"((?:[^"\\]|\\.)*)"/;

function firstMeaningfulLine(raw: string): string | null {
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    // Structural punctuation from a pretty-printed blob is not a sentence.
    if (trimmed.length >= 3 && /[a-z]/i.test(trimmed)) return trimmed;
  }
  return null;
}

function readableSource(raw: string): string | null {
  const embedded = JSON_MESSAGE.exec(raw);
  if (embedded?.[1]) {
    try {
      return JSON.parse(`"${embedded[1]}"`);
    } catch {
      return embedded[1];
    }
  }
  return firstMeaningfulLine(raw);
}

/** A bare code like `insufficient_credits` with nothing human around it. */
const BARE_CODE = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;

function humanizeBareCode(code: string): string {
  const words = code.split("_").join(" ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}.`;
}

/**
 * Turn whatever a service logged into one sentence worth showing.
 *
 * Never returns an empty string: an unrecognised error still gets its first
 * line through, because a strange message the user can screenshot beats a blank
 * row that says nothing at all.
 */
export function explainServiceError(raw: string): ServiceErrorCopy {
  const unknown = { text: "This run failed for an unknown reason.", fault: "unknown" as const };
  if (!raw.trim()) return unknown;

  // Recognition runs over the whole error, not just its first line: the code
  // that names the cause is usually buried inside a JSON body or below a stack
  // frame, and matching only the first line missed every one of them.
  //
  // The billing table already carries reviewed copy for the plan-level cases
  // and is what the upgrade dialog shows; reuse it so the two never disagree.
  const billing = matchBillingError(raw);
  if (billing) return { text: billing.title, fault: "billing" };

  const match = SERVICE_ERROR_PATTERNS.find(({ pattern }) => pattern.test(raw));
  if (match) return { text: match.text, fault: match.fault };

  const readable = readableSource(raw);
  if (!readable) return unknown;
  if (BARE_CODE.test(readable)) return { text: humanizeBareCode(readable), fault: "unknown" };
  return { text: readable, fault: "unknown" };
}

/**
 * The single fault worth acting on across every failing service, or null when
 * nothing is failing. Billing wins over everything else: it is the one cause
 * the user can clear immediately, and when credits run out every service fails
 * at once, so it would otherwise be buried under whichever error sorted first.
 */
export function dominantServiceFault(errors: Iterable<string>): ServiceErrorCopy | null {
  const explained = [...errors].map(explainServiceError);
  if (explained.length === 0) return null;
  const order: ServiceErrorFault[] = ["billing", "auth", "config", "provider", "unknown"];
  for (const fault of order) {
    const hit = explained.find((e) => e.fault === fault);
    if (hit) return hit;
  }
  return explained[0];
}
