import type {
  CanonicalTranscriptEnvelope,
  ConversationActionProposal,
  ConversationClaim,
  ConversationGovernanceReceipt,
  ConversationSegment,
  RelationshipObservationAssertionInput,
  RelationshipObservationInput,
  RelationshipObservationParticipantInput,
} from "@x/shared/dist/relationships.js";
import { ConversationGovernanceReceiptSchema } from "@x/shared/dist/relationships.js";

export type TranscriptProvider = CanonicalTranscriptEnvelope["provider"];

export interface TranscriptSourceSegment {
  speakerId?: string;
  speakerLabel?: string;
  speakerConfidence?: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface CanonicalTranscriptSource {
  provider: TranscriptProvider;
  sourceRecordId: string;
  title: string;
  occurredAt: string;
  participants?: RelationshipObservationParticipantInput[];
  segments: TranscriptSourceSegment[];
  captureCaveats?: string[];
  governance?: Partial<ConversationGovernanceReceipt>;
}

export interface ConversationRelationshipIdentity {
  relationshipId?: string;
  displayName?: string;
  primaryEmail?: string;
  accountDomain?: string;
  participants?: RelationshipObservationParticipantInput[];
}

export interface CompiledConversationEvidence {
  envelope: CanonicalTranscriptEnvelope;
  claims: ConversationClaim[];
  actions: ConversationActionProposal[];
  assertions: RelationshipObservationAssertionInput[];
}

const MAX_CANONICAL_TRANSCRIPT_CHARS = 250_000;
const MAX_CANONICAL_SEGMENT_CHARS = 4_000;

const MATERIAL_PATTERNS: Array<{
  kind: ConversationClaim["kind"];
  pattern: RegExp;
  stateDimension?: string;
  value: (text: string) => string;
}> = [
  {
    kind: "risk",
    pattern:
      /\b(risk|blocked|blocker|concern(?:ed)?|delay(?:ed)?|slip(?:ping)?|escalat(?:e|ed|ion)|cancel(?:led|ing)?|churn)\b/i,
    stateDimension: "risk",
    value: (text) => text,
  },
  {
    kind: "objection",
    pattern:
      /\b(too expensive|budget|not ready|can(?:not|'t)|won't|security concern|legal concern|procurement|pushback|objection)\b/i,
    stateDimension: "risk",
    value: (text) => text,
  },
  {
    kind: "decision",
    pattern:
      /\b(we (?:have )?decided|we agreed|decision is|move forward|approved|signed off|go with)\b/i,
    value: (text) => text,
  },
  {
    kind: "milestone",
    pattern: /\b(launched|went live|completed|finished|approved|signed|delivered|milestone)\b/i,
    stateDimension: "milestone",
    value: (text) => text,
  },
  {
    kind: "stakeholder",
    pattern:
      /\b(decision[- ]maker|executive sponsor|champion|stakeholder|procurement|legal team|security team|joining us|introduce you)\b/i,
    value: (text) => text,
  },
  {
    kind: "lifecycle",
    pattern:
      /\b(renewal|renew(?:ing)?|onboarding|implementation|contracting|contract|evaluation|pilot|trial|churn(?:ed)?|former customer)\b/i,
    stateDimension: "lifecycle",
    value: lifecycleValue,
  },
  {
    kind: "sentiment",
    pattern:
      /\b(frustrated|disappointed|unhappy|worried|concerned|love|excited|happy|great|pleased)\b/i,
    stateDimension: "sentiment",
    value: sentimentValue,
  },
  {
    kind: "commitment",
    pattern: /\b(i(?:'ll| will)|we(?:'ll| will)|i can|we can|i commit|we commit|i'll make sure)\b/i,
    stateDimension: "next_action",
    value: (text) => text,
  },
];

function lifecycleValue(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("former customer")) return "former_customer";
  if (lower.includes("churn")) return "churned";
  if (lower.includes("renew")) return "renewal";
  if (lower.includes("onboarding") || lower.includes("implementation")) return "onboarding";
  if (lower.includes("contract")) return "contracting";
  return "evaluation";
}

function sentimentValue(text: string): string {
  return /\b(frustrated|disappointed|unhappy|worried|concerned)\b/i.test(text)
    ? "negative"
    : "positive";
}

function clampConfidence(value: number | undefined, fallback: number): number {
  return Math.max(0, Math.min(1, value ?? fallback));
}

function splitSegmentText(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > MAX_CANONICAL_SEGMENT_CHARS) {
    let boundary = remaining.lastIndexOf(" ", MAX_CANONICAL_SEGMENT_CHARS);
    if (boundary < MAX_CANONICAL_SEGMENT_CHARS / 2) {
      boundary = MAX_CANONICAL_SEGMENT_CHARS;
    }
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/** Stable, non-secret content fingerprint used for replay deduplication. */
export function conversationFingerprint(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function defaultGovernance(source: CanonicalTranscriptSource): ConversationGovernanceReceipt {
  const imported = source.provider !== "oppulence" && source.provider !== "upload";
  const receiptSeed = `${source.provider}:${source.sourceRecordId}:${source.occurredAt}`;
  return ConversationGovernanceReceiptSchema.parse({
    receiptId: `governance:${conversationFingerprint(receiptSeed)}`,
    capturedAt: source.occurredAt,
    capturePolicy:
      source.provider === "upload"
        ? "explicit_upload"
        : imported
          ? "provider_import"
          : "manual_capture",
    routing: imported ? `${source.provider}_to_oppulence` : "local_transcription_to_oppulence",
    region: imported ? "provider_managed" : "local_device",
    retention: imported ? "provider_policy_plus_oppulence_evidence" : "until_transcribed",
    participantDisclosure: imported ? "provider_reported" : "not_recorded",
    legalHold: false,
    deletionOutcome: imported ? "not_applicable" : "scheduled_after_transcription",
    // Audio excerpts are never retained by this compiler. If a future capture path
    // retains one, the contract permits only the explicitly encrypted state.
    evidenceClip: "not_retained",
    ...source.governance,
  });
}

export function normalizeTranscript(
  source: CanonicalTranscriptSource,
): CanonicalTranscriptEnvelope {
  const captureCaveats = [...new Set(source.captureCaveats ?? [])];
  const segments: ConversationSegment[] = [];
  let transcriptChars = 0;
  let splitLongSegment = false;
  let truncated = false;
  for (const [sourceIndex, segment] of source.segments.entries()) {
    const chunks = splitSegmentText(segment.text);
    if (chunks.length > 1) splitLongSegment = true;
    for (const text of chunks) {
      if (transcriptChars + text.length > MAX_CANONICAL_TRANSCRIPT_CHARS) {
        truncated = true;
        break;
      }
      const index = segments.length;
      const label = segment.speakerLabel?.trim() || `Speaker ${sourceIndex + 1}`;
      const speakerId =
        segment.speakerId?.trim() ||
        `anonymous:${conversationFingerprint(
          `${source.provider}:${source.sourceRecordId}:${label.toLowerCase()}`,
        )}`;
      const anonymous = !segment.speakerId || /^speaker\s+\d+$/i.test(label) || label === "Other";
      segments.push({
        id: `segment:${index}:${conversationFingerprint(`${speakerId}:${segment.startMs}:${text}`)}`,
        speakerId,
        speakerLabel: label,
        speakerConfidence: clampConfidence(segment.speakerConfidence, anonymous ? 0.5 : 0.9),
        startMs: Math.max(0, Math.round(segment.startMs)),
        endMs: Math.max(Math.round(segment.startMs), Math.round(segment.endMs)),
        text,
      });
      transcriptChars += text.length;
    }
    if (truncated) break;
  }
  if (splitLongSegment) {
    captureCaveats.push("long source segments were split into bounded evidence excerpts");
  }
  if (truncated) {
    captureCaveats.push("transcript was truncated at the canonical evidence size limit");
  }
  const fingerprint = conversationFingerprint(
    JSON.stringify({
      provider: source.provider,
      sourceRecordId: source.sourceRecordId,
      segments: segments.map(({ speakerId, startMs, endMs, text }) => ({
        speakerId,
        startMs,
        endMs,
        text,
      })),
    }),
  );
  return {
    schemaVersion: 1,
    provider: source.provider,
    sourceRecordId: source.sourceRecordId,
    fingerprint,
    title: source.title.trim() || "Conversation",
    occurredAt: source.occurredAt,
    participants: source.participants ?? [],
    segments,
    captureCaveats,
    governance: defaultGovernance(source),
  };
}

function addDays(base: Date, days: number): Date {
  const result = new Date(base);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Resolve common spoken due phrases deterministically relative to the meeting. */
export function resolveSpokenDueAt(
  phrase: string | undefined,
  occurredAt: string,
): string | undefined {
  const value = phrase?.trim().toLowerCase();
  const base = new Date(occurredAt);
  if (!value || Number.isNaN(base.getTime())) return undefined;
  const iso = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return new Date(`${iso[1]}T17:00:00.000Z`).toISOString();
  if (/\btoday\b/.test(value))
    return new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 17),
    ).toISOString();
  if (/\btomorrow\b/.test(value)) {
    const day = addDays(base, 1);
    return new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 17),
    ).toISOString();
  }
  const relative = value.match(/\bin\s+(\d+)\s+(day|week)s?\b/);
  if (relative) {
    const amount = Number(relative[1]) * (relative[2] === "week" ? 7 : 1);
    const day = addDays(base, amount);
    return new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 17),
    ).toISOString();
  }
  if (/\bnext week\b/.test(value)) {
    const day = addDays(base, 7);
    return new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 17),
    ).toISOString();
  }
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const weekday = weekdays.findIndex((name) =>
    new RegExp(`\\b(?:next\\s+)?${name}\\b`).test(value),
  );
  if (weekday >= 0) {
    let days = (weekday - base.getUTCDay() + 7) % 7;
    if (days === 0 || value.includes("next ")) days += 7;
    const day = addDays(base, days);
    return new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 17),
    ).toISOString();
  }
  return undefined;
}

function duePhrase(text: string): string | undefined {
  return text.match(
    /\b(?:by|before|on)\s+((?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|today|tomorrow|next week|20\d{2}-\d{2}-\d{2})\b/i,
  )?.[1];
}

function compileClaims(envelope: CanonicalTranscriptEnvelope): ConversationClaim[] {
  const claims: ConversationClaim[] = [];
  for (const segment of envelope.segments) {
    for (const candidate of MATERIAL_PATTERNS) {
      if (!candidate.pattern.test(segment.text)) continue;
      const confidence = Math.min(0.9, segment.speakerConfidence + 0.15);
      const caveats = [...envelope.captureCaveats];
      if (segment.speakerConfidence < 0.75) caveats.push("speaker assignment requires review");
      claims.push({
        id: `claim:${conversationFingerprint(`${segment.id}:${candidate.kind}`)}`,
        kind: candidate.kind,
        value: candidate.value(segment.text),
        exactQuote: segment.text,
        startMs: segment.startMs,
        endMs: segment.endMs,
        speakerId: segment.speakerId,
        speakerLabel: segment.speakerLabel,
        speakerConfidence: segment.speakerConfidence,
        confidence,
        captureCaveats: [...new Set(caveats)],
        material: true,
        ...(candidate.stateDimension ? { stateDimension: candidate.stateDimension } : {}),
      });
    }
  }
  return claims;
}

function recapLines(claims: ConversationClaim[]): string {
  return claims
    .slice(0, 8)
    .map((claim) => `- ${claim.kind}: ${claim.value}`)
    .join("\n");
}

function compileActions(
  envelope: CanonicalTranscriptEnvelope,
  claims: ConversationClaim[],
): ConversationActionProposal[] {
  if (claims.length === 0) return [];
  const allIds = claims.map((claim) => claim.id);
  const recap = recapLines(claims);
  const actions: ConversationActionProposal[] = [
    {
      id: `action:${conversationFingerprint(`${envelope.fingerprint}:email`)}`,
      actionType: "meeting_recap",
      channel: "email",
      reason: "Send a recap grounded in the material statements from this conversation.",
      proposedSubject: `Recap: ${envelope.title}`,
      proposedMessage: `Thanks for the conversation. Here is my understanding:\n\n${recap}\n\nPlease reply with any corrections.`,
      evidenceClaimIds: allIds,
      confidence: 0.84,
    },
    {
      id: `action:${conversationFingerprint(`${envelope.fingerprint}:slack`)}`,
      actionType: "meeting_recap",
      channel: "slack",
      reason: "Share the evidence-backed recap with the account team.",
      proposedMessage: `Conversation recap — ${envelope.title}\n${recap}`,
      evidenceClaimIds: allIds,
      confidence: 0.82,
    },
  ];
  const crmClaims = claims.filter((claim) => claim.stateDimension || claim.kind === "stakeholder");
  if (crmClaims.length > 0) {
    actions.push({
      id: `action:${conversationFingerprint(`${envelope.fingerprint}:crm`)}`,
      actionType: "crm_update",
      channel: "crm",
      reason: "Update CRM fields from quoted lifecycle, risk, sentiment, and stakeholder evidence.",
      proposedMessage: recapLines(crmClaims),
      evidenceClaimIds: crmClaims.map((claim) => claim.id),
      confidence: Math.min(...crmClaims.map((claim) => claim.confidence)),
    });
  }
  for (const claim of claims.filter((candidate) => candidate.kind === "commitment")) {
    const dueAt = resolveSpokenDueAt(duePhrase(claim.exactQuote), envelope.occurredAt);
    actions.push({
      id: `action:${conversationFingerprint(`${envelope.fingerprint}:task:${claim.id}`)}`,
      actionType: "follow_up_task",
      channel: "task",
      reason: "Track a spoken commitment until it is fulfilled or renegotiated.",
      proposedMessage: claim.value,
      ...(dueAt ? { dueAt } : {}),
      evidenceClaimIds: [claim.id],
      confidence: claim.confidence,
    });
    if (dueAt) {
      actions.push({
        id: `action:${conversationFingerprint(`${envelope.fingerprint}:calendar:${claim.id}`)}`,
        actionType: "calendar_hold",
        channel: "calendar",
        reason: "Protect time before the spoken commitment is due.",
        proposedMessage: `Prepare and complete: ${claim.value}`,
        dueAt,
        evidenceClaimIds: [claim.id],
        confidence: claim.confidence,
      });
    }
  }
  return actions;
}

export function compileConversationEvidence(
  source: CanonicalTranscriptSource,
): CompiledConversationEvidence {
  const envelope = normalizeTranscript(source);
  const claims = compileClaims(envelope);
  const actions = compileActions(envelope, claims);
  const assertions: RelationshipObservationAssertionInput[] = claims
    .filter((claim): claim is ConversationClaim & { stateDimension: string } =>
      Boolean(claim.stateDimension),
    )
    .map((claim) => ({
      dimension: claim.stateDimension,
      value: claim.value,
      sourceType: "ai_inference",
      confidence: claim.confidence,
      reason: `Conversation claim ${claim.id}, supported by the exact quote at ${claim.startMs}-${claim.endMs} ms.`,
      validFrom: envelope.occurredAt,
    }));
  return { envelope, claims, actions, assertions };
}

/** Build the append-only provider-neutral observation consumed by the API. */
export function canonicalTranscriptObservation(args: {
  source: CanonicalTranscriptSource;
  identity: ConversationRelationshipIdentity;
}): RelationshipObservationInput {
  const compiled = compileConversationEvidence(args.source);
  const { envelope, claims, actions, assertions } = compiled;
  const participantResolution = [
    ...new Map(
      envelope.segments.map(
        (segment) =>
          [
            segment.speakerId,
            {
              speaker_id: segment.speakerId,
              label: segment.speakerLabel,
              confidence: segment.speakerConfidence,
              resolution_source:
                segment.speakerConfidence >= 0.85 ? "calendar_contact_or_provider" : "anonymous",
              scope: "meeting",
              persistent_voiceprint: false,
            },
          ] as const,
      ),
    ).values(),
  ];
  return {
    ...args.identity,
    participants: args.identity.participants ?? envelope.participants,
    source: "meeting",
    sourceAccountId: envelope.provider,
    externalId: `${envelope.provider}:${envelope.sourceRecordId}`,
    sourceVersion: envelope.fingerprint,
    eventType: "conversation_evidence_compiled",
    occurredAt: envelope.occurredAt,
    summary: `${envelope.title} · ${envelope.segments.length} segments · ${claims.length} material claims`,
    normalizedFacts: {
      provider: envelope.provider,
      dedupe_fingerprint: envelope.fingerprint,
      canonical_transcript: {
        schema_version: envelope.schemaVersion,
        source_record_id: envelope.sourceRecordId,
        segment_count: envelope.segments.length,
      },
      conversation_claims: claims,
      action_pack: actions,
      governance_receipt: envelope.governance,
      participant_resolution: participantResolution,
    },
    payload: { envelope },
    assertions,
  };
}
