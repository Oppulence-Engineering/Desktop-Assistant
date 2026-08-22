import type {
  CanonicalTranscriptEnvelope,
  ConversationActionProposal,
  ConversationClaim,
  ConversationGovernanceReceipt,
  ConversationExtractionResult,
  ConversationSegment,
  RelationshipObservationAssertionInput,
  RelationshipObservationInput,
  RelationshipObservationParticipantInput,
} from "@x/shared/relationships";
import { ConversationGovernanceReceiptSchema } from "@x/shared/relationships";
import { duePhrase, resolveSpokenDueAt } from "./conversation-dates.js";
import { conversationFingerprint } from "./conversation-utils.js";
import type { ConversationExtractor } from "./conversation-extractor.js";
import { HybridConversationExtractor } from "./conversation-extractor.js";

export { resolveSpokenDueAt } from "./conversation-dates.js";
export { conversationFingerprint } from "./conversation-utils.js";

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

const ALL_CONVERSATION_CLAIM_KINDS = [
  "risk",
  "objection",
  "decision",
  "milestone",
  "sentiment",
  "stakeholder",
  "lifecycle",
  "commitment",
] as const;

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

/** Attach a validated shadow extraction without changing projection or actions. */
export function attachConversationExtraction(
  observation: RelationshipObservationInput,
  extraction: ConversationExtractionResult,
): RelationshipObservationInput {
  const envelope = (observation.payload as { envelope?: CanonicalTranscriptEnvelope } | undefined)
    ?.envelope;
  if (!envelope || extraction.envelopeFingerprint !== envelope.fingerprint) {
    throw new Error("conversation extraction does not match the observation envelope");
  }
  return {
    ...observation,
    // Semantic and deterministic fallback candidates are review proposals. The
    // compatibility compiler remains visible for shadow comparison, but it no longer
    // publishes assertions or follow-through actions on the promoted async path.
    assertions: [],
    normalizedFacts: {
      ...observation.normalizedFacts,
      legacy_shadow_action_pack: observation.normalizedFacts.action_pack ?? [],
      action_pack: [],
      conversation_extraction: {
        schema_version: extraction.schemaVersion,
        envelope_fingerprint: extraction.envelopeFingerprint,
        provenance: extraction.provenance,
        candidate_count: extraction.candidates.length,
        rejected_candidate_count: extraction.rejectedCandidates.length,
      },
      conversation_claim_candidates: extraction.candidates,
      conversation_candidate_rejections: extraction.rejectedCandidates,
    },
  };
}

/**
 * Run the hybrid extractor in shadow mode and preserve the compatibility claims.
 * Promotion to canonical assertions is intentionally owned by the review lifecycle.
 */
export async function canonicalTranscriptObservationWithExtraction(args: {
  source: CanonicalTranscriptSource;
  identity: ConversationRelationshipIdentity;
  extractor?: ConversationExtractor;
}): Promise<RelationshipObservationInput> {
  const observation = canonicalTranscriptObservation(args);
  const envelope = (observation.payload as { envelope: CanonicalTranscriptEnvelope }).envelope;
  const extractor = args.extractor ?? new HybridConversationExtractor();
  const extraction = await extractor.extract({
    envelope,
    extractorVersion: extractor.version,
    requestedClaimKinds: [...ALL_CONVERSATION_CLAIM_KINDS],
  });
  return attachConversationExtraction(observation, extraction);
}
