import type {
  RelationshipLiveCue,
  RelationshipLiveCueFrequency,
  RelationshipLiveCueKind,
} from "@x/shared/relationships";
import { conversationFingerprint, normalizeConversationText } from "./conversation-utils.js";

export interface LiveCoachingSignal {
  kind: RelationshipLiveCueKind;
  evidenceRef: string;
  exactQuote: string;
  confidence: number;
}

export interface LiveCoachingPreferences {
  frequency: RelationshipLiveCueFrequency;
  disabledKinds?: RelationshipLiveCueKind[];
  cooldownMs?: number;
  maxVisible?: number;
}

export interface IncrementalConversationSegment {
  startMs: number;
  endMs: number;
  text: string;
}

const OBJECTION = /\b(concern(?:ed)?|worried|objection|not comfortable|can't|cannot|won't|blocker)\b/i;
const STAKEHOLDER = /\b(check with|talk to|bring in|involve|sign[ -]?off|approval from)\b/i;
const COMPETITOR = /\b(competitor|alternative|instead of|versus|vs\.?|other vendor)\b/i;
const PROMISE = /\b(i|we|you|they)\s+(?:will|'ll|can commit to|promise to)|\bwe commit to\b/i;
const DATE = /\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week|by the|\d{1,2}[/-]\d{1,2})\b/i;
const OWNERLESS = /\b(needs? to be|should be|has to be|someone (?:will|should))\b/i;

/** Deterministic, device-only signal detection over already-local live segments. */
export function detectLiveCoachingSignals(args: {
  meetingId: string;
  segments: IncrementalConversationSegment[];
}): LiveCoachingSignal[] {
  const signals: LiveCoachingSignal[] = [];
  for (const segment of args.segments) {
    const quote = segment.text.trim();
    if (!quote) continue;
    const evidenceRef = `live:${args.meetingId}:${segment.startMs}-${segment.endMs}`;
    const add = (kind: RelationshipLiveCueKind, confidence: number) =>
      signals.push({ kind, evidenceRef, exactQuote: quote, confidence });
    if (OBJECTION.test(quote)) add("unresolved_objection", 0.82);
    if (STAKEHOLDER.test(quote)) add("stakeholder_gap", 0.76);
    if (COMPETITOR.test(quote)) add("competitor_resurfaced", 0.78);
    if (PROMISE.test(quote) && !DATE.test(quote)) add("promise_missing_date", 0.86);
    if (OWNERLESS.test(quote)) add("promise_missing_owner", 0.72);
  }
  return signals;
}

const QUESTIONS: Record<RelationshipLiveCueKind, string> = {
  overdue_commitment: "Would it help to agree on a new owner or date for that commitment?",
  unresolved_objection: "What would need to be true for that concern to feel resolved?",
  renewal_context: "What outcome will determine whether renewal is successful?",
  missing_next_step: "What is the concrete next step, owner, and date?",
  contradiction: "Which of these two values should we treat as current?",
  stakeholder_gap: "Who else needs to be involved in this decision?",
  competitor_resurfaced: "What is making that alternative relevant again?",
  promise_missing_owner: "Who owns that promise?",
  promise_missing_date: "When should that promise be completed?",
};

/** Pure local cue engine. It cannot send, speak, or mutate relationship state. */
export function generateLiveCoachingCues(args: {
  meetingId: string;
  signals: LiveCoachingSignal[];
  preferences: LiveCoachingPreferences;
  priorCues?: RelationshipLiveCue[];
  now: string;
}): RelationshipLiveCue[] {
  if (args.preferences.frequency === "off") return [];
  const disabled = new Set(args.preferences.disabledKinds ?? []);
  const cooldownMs = args.preferences.cooldownMs ?? 5 * 60_000;
  const maxVisible = Math.min(
    args.preferences.maxVisible ?? (args.preferences.frequency === "minimal" ? 1 : 2),
    args.preferences.frequency === "minimal" ? 1 : 3,
  );
  const nowMs = Date.parse(args.now);
  const seenKeys = new Set<string>();
  const result: RelationshipLiveCue[] = [];

  for (const signal of args.signals) {
    if (result.length >= maxVisible || disabled.has(signal.kind) || !signal.evidenceRef) continue;
    const key = `${signal.kind}:${normalizeConversationText(signal.exactQuote)}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const recent = (args.priorCues ?? []).some(
      (cue) =>
        cue.kind === signal.kind &&
        cue.sourceRefs.includes(signal.evidenceRef) &&
        cue.createdAt !== undefined &&
        nowMs - Date.parse(cue.createdAt) < cooldownMs,
    );
    if (recent) continue;
    result.push({
      id: `cue:${conversationFingerprint(`${args.meetingId}:${key}`)}`,
      kind: signal.kind,
      title: signal.kind.replaceAll("_", " "),
      detail: signal.exactQuote,
      severity:
        signal.kind === "overdue_commitment" || signal.kind === "contradiction"
          ? "attention"
          : "info",
      evidenceId: signal.evidenceRef,
      sourceRefs: [signal.evidenceRef],
      suggestedQuestion: QUESTIONS[signal.kind],
      triggerReason: `validated incremental signal: ${signal.kind}`,
      createdAt: args.now,
      expiresAt: new Date(nowMs + 15 * 60_000).toISOString(),
      confidence: signal.confidence,
      privacyRoute: "deterministic",
      dismissalState: "visible",
    });
  }
  return result;
}
