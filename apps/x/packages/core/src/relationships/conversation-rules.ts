import type { CanonicalTranscriptEnvelope } from "@x/shared/relationships";
import type { ConversationCandidateDraft } from "./conversation-validator.js";
import { duePhrase } from "./conversation-dates.js";

type DraftFactory = (
  text: string,
  speakerId: string,
) => ConversationCandidateDraft["normalizedValue"] | null;

const RULES: Array<{
  kind: ConversationCandidateDraft["kind"];
  pattern: RegExp;
  value: DraftFactory;
}> = [
  {
    kind: "risk",
    pattern:
      /\b(risk|blocked|blocker|concern(?:ed)?|delay(?:ed)?|slip(?:ping)?|escalat(?:e|ed|ion)|cancel(?:led|ing)?|churn)\b/i,
    value: (text) => ({ kind: "risk", text }),
  },
  {
    kind: "objection",
    pattern:
      /\b(too expensive|budget|not ready|can(?:not|'t)|won't|security concern|legal concern|procurement|pushback|objection)\b/i,
    value: (text) => ({ kind: "objection", text }),
  },
  {
    kind: "decision",
    pattern:
      /\b(we (?:have )?decided|we agreed|decision is|move forward|approved|signed off|go with)\b/i,
    value: (text) => ({ kind: "decision", text }),
  },
  {
    kind: "milestone",
    pattern: /\b(launched|went live|completed|finished|approved|signed|delivered|milestone)\b/i,
    value: (text) => ({ kind: "milestone", text }),
  },
  {
    kind: "stakeholder",
    pattern:
      /\b([A-Z][\p{L}'-]+)\s+is\s+(?:our|the)\s+(decision[- ]maker|executive sponsor|champion|blocker|owner)\b/iu,
    value: (text) => {
      const match = text.match(
        /\b([A-Z][\p{L}'-]+)\s+is\s+(?:our|the)\s+(decision[- ]maker|executive sponsor|champion|blocker|owner)\b/iu,
      );
      if (!match) return null;
      const roles: Record<
        string,
        "decision_maker" | "executive_sponsor" | "champion" | "blocker" | "owner"
      > = {
        "decision-maker": "decision_maker",
        "decision maker": "decision_maker",
        "executive sponsor": "executive_sponsor",
        champion: "champion",
        blocker: "blocker",
        owner: "owner",
      };
      return {
        kind: "stakeholder",
        displayName: match[1],
        role: roles[match[2].toLowerCase()],
      };
    },
  },
  {
    kind: "lifecycle",
    pattern:
      /\b(renewal|renew(?:ing)?|onboarding|implementation|contracting|contract|evaluation|pilot|trial|churn(?:ed)?|former customer)\b/i,
    value: (text) => {
      const lower = text.toLowerCase();
      const lifecycle = lower.includes("former customer")
        ? "former_customer"
        : lower.includes("churn")
          ? "churned"
          : lower.includes("renew")
            ? "renewal"
            : lower.includes("onboarding") || lower.includes("implementation")
              ? "onboarding"
              : lower.includes("contract")
                ? "contracting"
                : "evaluation";
      return { kind: "lifecycle", lifecycle };
    },
  },
  {
    kind: "sentiment",
    pattern:
      /\b(frustrated|disappointed|unhappy|worried|concerned|love|excited|happy|great|pleased)\b/i,
    value: (text) => ({
      kind: "sentiment",
      sentiment: /\b(frustrated|disappointed|unhappy|worried|concerned)\b/i.test(text)
        ? "negative"
        : "positive",
    }),
  },
  {
    kind: "commitment",
    pattern:
      /\b(i(?:'ll| will)|we(?:'ll| will)|i commit|we commit|i'll make sure|we'll make sure)\b/i,
    value: (text, speakerId) => ({
      kind: "commitment",
      action: text,
      ownerSpeakerId: speakerId,
      acceptance: "explicit",
      ...(duePhrase(text) ? { duePhrase: duePhrase(text) } : {}),
      dependencyCandidateIds: [],
    }),
  },
];

/**
 * Conservative offline candidates used only when semantic extraction cannot run.
 * Every candidate carries a review caveat and still passes the exact-evidence validator.
 */
export function extractRuleConversationCandidates(
  envelope: CanonicalTranscriptEnvelope,
): ConversationCandidateDraft[] {
  const candidates: ConversationCandidateDraft[] = [];
  for (const segment of envelope.segments) {
    for (const rule of RULES) {
      if (!rule.pattern.test(segment.text)) continue;
      const normalizedValue = rule.value(segment.text, segment.speakerId);
      if (!normalizedValue) continue;
      candidates.push({
        kind: rule.kind,
        normalizedValue,
        evidence: [
          {
            exactQuote: segment.text,
            speakerId: segment.speakerId,
            startMs: segment.startMs,
          },
        ],
        speakerRef: segment.speakerId,
        confidence: Math.min(0.75, segment.speakerConfidence),
        caveats: ["deterministic fallback candidate requires review"],
      });
    }
  }
  return candidates;
}
