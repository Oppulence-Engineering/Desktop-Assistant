import { z } from "zod";

export const RelationshipSchema = z.object({
  id: z.string(),
  kind: z.string(),
  displayName: z.string(),
  primaryEmail: z.string().optional(),
  accountDomain: z.string().optional(),
  summary: z.string().optional(),
  status: z.string(),
  lastTouchAt: z.string().optional(),
  nextActionAt: z.string().optional(),
  openActions: z.number().optional(),
  nextAction: z.string().optional(),
  lifecycle: z.string(),
  engagement: z.string(),
  sentiment: z.string(),
  health: z.string(),
  stateReason: z.string().optional(),
  stateVersion: z.number(),
  lastChangedAt: z.string().optional(),
  risks: z.array(z.string()),
  milestones: z.array(z.string()),
});

export const RelationshipActionSchema = z.object({
  id: z.string(),
  relationshipId: z.string().optional(),
  actionType: z.string(),
  channel: z.string(),
  detector: z.string(),
  reason: z.string(),
  proposedSubject: z.string().optional(),
  proposedMessage: z.string().optional(),
  priorityScore: z.number(),
  queueStatus: z.string(),
  policyStatus: z.string(),
  approvalStatus: z.string(),
  executionStatus: z.string(),
  executionMode: z.string(),
  evidence: z
    .array(
      z.object({
        id: z.string(),
        source: z.string(),
        sourceRecordId: z.string(),
        excerpt: z.string().optional(),
        occurredAt: z.string(),
        externalEvidenceRefs: z.array(z.string()),
      }),
    )
    .optional()
    .default([]),
});

export const RelationshipParticipantSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string().optional(),
  role: z.string(),
  title: z.string().optional(),
  active: z.boolean(),
  externalRefs: z.array(z.string()),
});

export const RelationshipCommitmentSchema = z.object({
  id: z.string(),
  direction: z.string(),
  text: z.string(),
  status: z.string(),
  dueAt: z.string().optional(),
  confidence: z.number(),
  userConfirmed: z.boolean(),
});

export const RelationshipObservationSchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceAccountId: z.string().optional(),
  externalId: z.string(),
  sourceVersion: z.string(),
  eventType: z.string(),
  occurredAt: z.string(),
  receivedAt: z.string(),
  summary: z.string().optional(),
  normalizedFacts: z.record(z.string(), z.unknown()),
  contentHash: z.string(),
});

export const RelationshipObservationAssertionInputSchema = z.object({
  dimension: z.string(),
  value: z.string(),
  sourceType: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  validFrom: z.string(),
});

export const RelationshipObservationParticipantInputSchema = z.object({
  displayName: z.string(),
  email: z.string().optional(),
  role: z.string().optional(),
  title: z.string().optional(),
  externalRefs: z.array(z.string()).optional(),
});

/**
 * Provider-neutral append-only evidence accepted by the shared relationship engine.
 * At least one relationship identity field is required by the API when relationshipId
 * is absent; the desktop only publishes automatically resolved 1:1 meetings.
 */
export const RelationshipObservationInputSchema = z.object({
  relationshipId: z.string().optional(),
  displayName: z.string().optional(),
  primaryEmail: z.string().optional(),
  accountDomain: z.string().optional(),
  source: z.string(),
  sourceAccountId: z.string().optional(),
  externalId: z.string(),
  sourceVersion: z.string().default("1"),
  eventType: z.string(),
  occurredAt: z.string(),
  receivedAt: z.string().optional(),
  summary: z.string().optional(),
  normalizedFacts: z.record(z.string(), z.unknown()).default({}),
  payload: z.unknown().optional(),
  participants: z.array(RelationshipObservationParticipantInputSchema).optional(),
  assertions: z.array(RelationshipObservationAssertionInputSchema).optional(),
});

export const RelationshipObservationIngestResultSchema = z.object({
  observation: RelationshipObservationSchema,
  relationship: RelationshipSchema,
  duplicate: z.boolean(),
});

// ---------------------------------------------------------------------------
// Conversation evidence
// ---------------------------------------------------------------------------

/**
 * The recorder-neutral segment stored in a canonical conversation envelope.
 * `speakerId` is scoped to this conversation. It is deliberately not a voiceprint
 * or a durable person identifier.
 */
export const ConversationSegmentSchema = z.object({
  id: z.string(),
  speakerId: z.string(),
  speakerLabel: z.string(),
  speakerConfidence: z.number().min(0).max(1),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  text: z.string(),
});

export const ConversationGovernanceReceiptSchema = z.object({
  receiptId: z.string(),
  capturedAt: z.string(),
  capturePolicy: z.string(),
  routing: z.string(),
  region: z.string(),
  retention: z.string(),
  participantDisclosure: z.string(),
  legalHold: z.boolean(),
  deletionOutcome: z.string(),
  evidenceClip: z.enum(["not_retained", "encrypted"]),
});

export const CanonicalTranscriptEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  provider: z.enum([
    "oppulence",
    "upload",
    "fireflies",
    "granola",
    "zoom",
    "teams",
    "fathom",
    "crm",
  ]),
  sourceRecordId: z.string(),
  fingerprint: z.string(),
  title: z.string(),
  occurredAt: z.string(),
  participants: z.array(RelationshipObservationParticipantInputSchema),
  segments: z.array(ConversationSegmentSchema),
  captureCaveats: z.array(z.string()),
  governance: ConversationGovernanceReceiptSchema,
});

export const ConversationClaimKindSchema = z.enum([
  "risk",
  "objection",
  "decision",
  "milestone",
  "sentiment",
  "stakeholder",
  "lifecycle",
  "commitment",
]);

/** Every material model claim is reviewable at the exact words that support it. */
export const ConversationClaimSchema = z.object({
  id: z.string(),
  kind: ConversationClaimKindSchema,
  value: z.string(),
  exactQuote: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  speakerId: z.string(),
  speakerLabel: z.string(),
  speakerConfidence: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  captureCaveats: z.array(z.string()),
  material: z.boolean(),
  stateDimension: z.string().optional(),
  contradictionOf: z.string().optional(),
});

export const ConversationActionProposalSchema = z.object({
  id: z.string(),
  actionType: z.enum([
    "meeting_recap",
    "crm_update",
    "follow_up_task",
    "calendar_hold",
    "commitment_rescue",
  ]),
  channel: z.enum(["email", "slack", "crm", "task", "calendar"]),
  reason: z.string(),
  proposedSubject: z.string().optional(),
  proposedMessage: z.string(),
  dueAt: z.string().optional(),
  evidenceClaimIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const ConversationReviewItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["word", "speaker", "entity", "claim", "capture"]),
  label: z.string(),
  currentValue: z.string(),
  confidence: z.number().min(0).max(1),
  observationId: z.string(),
  claimId: z.string().optional(),
  stateDimension: z.string().optional(),
  exactQuote: z.string().optional(),
});

export const RelationshipDeltaItemSchema = z.object({
  dimension: z.string(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  reason: z.string().optional(),
  assertionIds: z.array(z.string()),
});

export const RelationshipContradictionSchema = z.object({
  dimension: z.string(),
  currentValue: z.string(),
  contradictedValue: z.string(),
  currentAssertionId: z.string(),
  contradictedAssertionId: z.string(),
});

export const RelationshipDeltaSchema = z.object({
  fromVersion: z.number(),
  toVersion: z.number(),
  changes: z.array(RelationshipDeltaItemSchema),
  uncertainClaimIds: z.array(z.string()),
  contradictions: z.array(RelationshipContradictionSchema),
  recommendationReason: z.string().optional(),
});

export const RelationshipLiveCueSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "overdue_commitment",
    "unresolved_objection",
    "renewal_context",
    "missing_next_step",
    "contradiction",
  ]),
  title: z.string(),
  detail: z.string(),
  severity: z.enum(["info", "attention", "critical"]),
  evidenceId: z.string().optional(),
});

export const RelationshipIntelligenceSchema = z.object({
  claims: z.array(ConversationClaimSchema),
  reviewItems: z.array(ConversationReviewItemSchema),
  governanceReceipts: z.array(ConversationGovernanceReceiptSchema),
  delta: RelationshipDeltaSchema,
  liveCues: z.array(RelationshipLiveCueSchema),
});

export const RelationshipStateSnapshotSchema = z.object({
  id: z.string(),
  version: z.number(),
  state: z.record(z.string(), z.unknown()),
  changedDimensions: z.array(z.string()),
  assertionIds: z.array(z.string()),
  createdAt: z.string(),
});

export const RelationshipSourceStatusSchema = z.object({
  source: z.string(),
  sourceAccountId: z.string(),
  status: z.string(),
  lastSuccessAt: z.string().optional(),
  lastObservationAt: z.string().optional(),
  lastError: z.string().optional(),
});

export const RelationshipSemanticMatchSchema = z.object({
  threadId: z.string(),
  subject: z.string(),
  counterparty: z.string(),
  classification: z.string(),
  summary: z.string(),
  score: z.number(),
});

export const RelationshipDetailSchema = z.object({
  relationship: RelationshipSchema,
  actions: z.array(RelationshipActionSchema),
  recommendations: z.array(RelationshipActionSchema),
  participants: z.array(RelationshipParticipantSchema),
  commitments: z.array(RelationshipCommitmentSchema),
  intelligence: RelationshipIntelligenceSchema.optional(),
});

export type Relationship = z.infer<typeof RelationshipSchema>;
export type RelationshipAction = z.infer<typeof RelationshipActionSchema>;
export type RelationshipDetail = z.infer<typeof RelationshipDetailSchema>;
export type RelationshipObservation = z.infer<typeof RelationshipObservationSchema>;
export type RelationshipObservationInput = z.infer<typeof RelationshipObservationInputSchema>;
export type RelationshipObservationAssertionInput = z.infer<
  typeof RelationshipObservationAssertionInputSchema
>;
export type RelationshipObservationParticipantInput = z.infer<
  typeof RelationshipObservationParticipantInputSchema
>;
export type RelationshipObservationIngestResult = z.infer<
  typeof RelationshipObservationIngestResultSchema
>;
export type RelationshipStateSnapshot = z.infer<typeof RelationshipStateSnapshotSchema>;
export type RelationshipSourceStatus = z.infer<typeof RelationshipSourceStatusSchema>;
export type RelationshipSemanticMatch = z.infer<typeof RelationshipSemanticMatchSchema>;
export type ConversationSegment = z.infer<typeof ConversationSegmentSchema>;
export type ConversationGovernanceReceipt = z.infer<typeof ConversationGovernanceReceiptSchema>;
export type CanonicalTranscriptEnvelope = z.infer<typeof CanonicalTranscriptEnvelopeSchema>;
export type ConversationClaim = z.infer<typeof ConversationClaimSchema>;
export type ConversationActionProposal = z.infer<typeof ConversationActionProposalSchema>;
export type ConversationReviewItem = z.infer<typeof ConversationReviewItemSchema>;
export type RelationshipDelta = z.infer<typeof RelationshipDeltaSchema>;
export type RelationshipLiveCue = z.infer<typeof RelationshipLiveCueSchema>;
export type RelationshipIntelligence = z.infer<typeof RelationshipIntelligenceSchema>;
