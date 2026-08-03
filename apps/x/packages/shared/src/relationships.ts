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
  stateHash: z.string().optional(),
  projectorVersion: z.number(),
  projectedAt: z.string().optional(),
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
  revision: z.number().int().positive(),
  revisionHash: z.string(),
  reason: z.string(),
  recipientEmail: z.string().optional(),
  proposedSubject: z.string().optional(),
  proposedMessage: z.string().optional(),
  senderAccountRef: z.string().optional(),
  priorityScore: z.number(),
  priorityComponents: z.record(z.string(), z.number()).optional(),
  queueStatus: z.string(),
  policyStatus: z.string(),
  approvalStatus: z.string(),
  executionStatus: z.string(),
  executionOwner: z.string(),
  executionMode: z.string(),
  approvedRevision: z.number().int().positive().optional(),
  approvedAt: z.string().optional(),
  providerMessageId: z.string().optional(),
  providerThreadId: z.string().optional(),
  executedAt: z.string().optional(),
  executionError: z.string().optional(),
  reconciliationStatus: z.string().optional(),
  reconciliationAttempts: z.number().int().nonnegative().optional(),
  reconciliationCheckedAt: z.string().optional(),
  reconciliationNextAt: z.string().optional(),
  reconciliationError: z.string().optional(),
  dismissReason: z.string().optional(),
  snoozedUntil: z.string().optional(),
  dueAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
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

export const RelationshipPolicyDecisionSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
  revisionHash: z.string(),
  status: z.enum(["passed", "review_required", "blocked"]),
  reasonCodes: z.array(z.string()).optional(),
  verification: z.record(z.string(), z.unknown()).optional(),
  suppression: z.record(z.string(), z.unknown()).optional(),
  research: z.record(z.string(), z.unknown()).optional(),
  crm: z.record(z.string(), z.unknown()).optional(),
  evaluatedAt: z.string(),
  expiresAt: z.string(),
});

export const RelationshipOutcomeSchema = z.object({
  id: z.string(),
  kind: z.string(),
  source: z.string(),
  sourceEventId: z.string(),
  occurredAt: z.string(),
});

export const RelationshipActionRevisionSchema = z.object({
  revision: z.number().int().positive(),
  revisionHash: z.string(),
  actionType: z.string(),
  channel: z.string(),
  createdAt: z.string(),
});

export const RelationshipActionAuditSchema = z.object({
  action: RelationshipActionSchema,
  revisions: z.array(RelationshipActionRevisionSchema),
  decisions: z.array(RelationshipPolicyDecisionSchema),
  outcomes: z.array(RelationshipOutcomeSchema),
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
  ownerParticipantRef: z.string().optional(),
  counterpartyParticipantRef: z.string().optional(),
  beneficiaryParticipantRef: z.string().optional(),
  sourcePhrase: z.string().optional(),
  duePhrase: z.string().optional(),
  dueTimezone: z.string().optional(),
  acceptance: z
    .enum(["candidate", "internally_confirmed", "offered", "accepted", "disputed"])
    .optional(),
  blocker: z.string().optional(),
  completedAt: z.string().optional(),
  currentEventVersion: z.number().int().nonnegative().optional(),
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

export const ConversationExtractionRoutingSchema = z.enum([
  "device",
  "cloud",
  "deterministic",
  "unknown",
]);

/** Versioned provenance for one semantic extraction pass. */
export const ConversationExtractionProvenanceSchema = z.object({
  extractorVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  routing: ConversationExtractionRoutingSchema,
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number().nonnegative(),
});

/** An exact, validator-resolved span in the canonical transcript. */
export const ConversationEvidenceSpanSchema = z.object({
  exactQuote: z.string().min(1),
  segmentIds: z.array(z.string().min(1)).min(1),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  speakerId: z.string().optional(),
});

const ConversationTextValueSchema = z.object({ text: z.string().min(1) });

/** Kind-specific values accepted from the semantic extraction layer. */
export const ConversationNormalizedValueSchema = z.discriminatedUnion("kind", [
  ConversationTextValueSchema.extend({ kind: z.literal("risk") }),
  ConversationTextValueSchema.extend({ kind: z.literal("objection") }),
  ConversationTextValueSchema.extend({ kind: z.literal("decision") }),
  ConversationTextValueSchema.extend({ kind: z.literal("milestone") }),
  z.object({
    kind: z.literal("sentiment"),
    sentiment: z.enum(["positive", "neutral", "negative", "mixed"]),
  }),
  z.object({
    kind: z.literal("stakeholder"),
    displayName: z.string().min(1),
    role: z
      .enum([
        "contact",
        "primary_contact",
        "champion",
        "decision_maker",
        "blocker",
        "executive_sponsor",
        "owner",
        "former_contact",
      ])
      .optional(),
  }),
  z.object({
    kind: z.literal("lifecycle"),
    lifecycle: z.enum([
      "prospecting",
      "evaluation",
      "contracting",
      "onboarding",
      "active_customer",
      "renewal",
      "churned",
      "former_customer",
    ]),
  }),
  z.object({
    kind: z.literal("commitment"),
    action: z.string().min(1),
    ownerSpeakerId: z.string().min(1),
    counterpartySpeakerId: z.string().optional(),
    acceptance: z.enum(["explicit", "ambiguous"]),
    duePhrase: z.string().optional(),
    dueAt: z.string().optional(),
    dependencyCandidateIds: z.array(z.string()).default([]),
  }),
]);

/** A model-proposed claim after deterministic evidence validation. */
export const ConversationClaimCandidateSchema = z.object({
  candidateId: z.string().min(1),
  kind: ConversationClaimKindSchema,
  normalizedValue: ConversationNormalizedValueSchema,
  displayValue: z.string().min(1),
  evidence: z.array(ConversationEvidenceSpanSchema).min(1),
  speakerRef: z.string().optional(),
  subjectRef: z.string().optional(),
  counterpartyRef: z.string().optional(),
  stateDimension: z.string().optional(),
  duePhrase: z.string().optional(),
  dueAt: z.string().optional(),
  confidence: z.number().min(0).max(1),
  caveats: z.array(z.string()),
  extractor: ConversationExtractionProvenanceSchema,
});

export const ConversationCandidateRejectionReasonSchema = z.enum([
  "schema_invalid",
  "kind_mismatch",
  "quote_missing",
  "quote_too_short",
  "speaker_missing",
  "owner_missing",
  "date_invalid",
  "duplicate",
]);

export const ConversationCandidateRejectionSchema = z.object({
  index: z.number().nonnegative(),
  reason: ConversationCandidateRejectionReasonSchema,
  detail: z.string(),
});

export const BoundedRelationshipContextSchema = z.object({
  relationshipId: z.string().optional(),
  lifecycle: z.string().optional(),
  sentiment: z.string().optional(),
  risks: z.array(z.string()).max(20).default([]),
  milestones: z.array(z.string()).max(20).default([]),
  openCommitments: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        direction: z.string(),
        dueAt: z.string().optional(),
      }),
    )
    .max(25)
    .default([]),
});

export const ConversationExtractionRequestSchema = z.object({
  envelope: CanonicalTranscriptEnvelopeSchema,
  relationshipContext: BoundedRelationshipContextSchema.optional(),
  extractorVersion: z.string().min(1),
  requestedClaimKinds: z.array(ConversationClaimKindSchema).min(1),
});

export const ConversationExtractionResultSchema = z.object({
  schemaVersion: z.literal(2),
  envelopeFingerprint: z.string().min(1),
  candidates: z.array(ConversationClaimCandidateSchema),
  rejectedCandidates: z.array(ConversationCandidateRejectionSchema),
  provenance: ConversationExtractionProvenanceSchema,
});

// ---------------------------------------------------------------------------
// Conversation review and commitment authority
// ---------------------------------------------------------------------------

export const ConversationReviewItemStatusSchema = z.enum([
  "pending_review",
  "accepted",
  "corrected",
  "rejected",
  "deferred",
]);

export const ConversationReviewDecisionKindSchema = z.enum([
  "approve",
  "correct",
  "reject",
  "defer",
]);

export const ConversationReviewBatchItemSchema = z.object({
  itemId: z.string().min(1),
  candidate: ConversationClaimCandidateSchema,
  status: ConversationReviewItemStatusSchema,
  before: z.unknown().optional(),
  proposedAfter: z.unknown(),
  dependentActionIds: z.array(z.string()).default([]),
});

export const ConversationReviewBatchSchema = z.object({
  batchId: z.string().min(1),
  relationshipId: z.string().min(1),
  observationId: z.string().min(1),
  extractorVersion: z.string().min(1),
  baselineSnapshotId: z.string().min(1),
  baselineVersion: z.number().int().nonnegative(),
  status: z.enum(["pending", "partially_decided", "decided"]),
  createdAt: z.string(),
  items: z.array(ConversationReviewBatchItemSchema),
});

export const ConversationReviewDecisionSchema = z.object({
  decisionId: z.string().min(1),
  batchId: z.string().min(1),
  itemId: z.string().min(1),
  kind: ConversationReviewDecisionKindSchema,
  actorId: z.string().min(1),
  reason: z.string().optional(),
  replacementValue: ConversationNormalizedValueSchema.optional(),
  deferUntil: z.string().optional(),
  baselineVersion: z.number().int().nonnegative(),
  decidedAt: z.string(),
  assertionId: z.string().optional(),
  commitmentEventId: z.string().optional(),
  invalidatedActionIds: z.array(z.string()).default([]),
});

export const CommitmentAcceptanceSchema = z.enum([
  "candidate",
  "internally_confirmed",
  "offered",
  "accepted",
  "disputed",
]);

export const CommitmentStateSchema = z.enum([
  "candidate",
  "internally_confirmed",
  "offered",
  "accepted",
  "open",
  "blocked",
  "fulfilled",
  "renegotiated",
  "cancelled",
  "superseded",
  "disputed",
]);

export const CommitmentEventKindSchema = z.enum([
  "proposed",
  "internally_confirmed",
  "offered",
  "accepted",
  "disputed",
  "blocked",
  "unblocked",
  "due_date_changed",
  "renegotiated",
  "fulfilled",
  "cancelled",
  "superseded",
]);

export const CommitmentEventSchema = z.object({
  eventId: z.string().min(1),
  commitmentId: z.string().min(1),
  version: z.number().int().positive(),
  kind: CommitmentEventKindSchema,
  actorType: z.enum(["user", "source_fact", "deterministic_rule", "ai_candidate"]),
  actorRef: z.string().optional(),
  occurredAt: z.string(),
  sourceObservationId: z.string().optional(),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  ownerParticipantRef: z.string().optional(),
  counterpartyParticipantRef: z.string().optional(),
  beneficiaryParticipantRef: z.string().optional(),
  action: z.string().optional(),
  duePhrase: z.string().optional(),
  dueAt: z.string().optional(),
  dueTimezone: z.string().optional(),
  blocker: z.string().optional(),
  reason: z.string().optional(),
  supersedesCommitmentId: z.string().optional(),
});

export const CommitmentProjectionSchema = z.object({
  commitmentId: z.string().min(1),
  version: z.number().int().nonnegative(),
  state: CommitmentStateSchema,
  acceptance: CommitmentAcceptanceSchema,
  ownerParticipantRef: z.string().optional(),
  counterpartyParticipantRef: z.string().optional(),
  beneficiaryParticipantRef: z.string().optional(),
  action: z.string().optional(),
  originalDuePhrase: z.string().optional(),
  dueAt: z.string().optional(),
  dueTimezone: z.string().optional(),
  blocker: z.string().optional(),
  completedAt: z.string().optional(),
  sourceObservationId: z.string().optional(),
  evidenceRefs: z.array(z.string()),
});

export const CommitmentDependencySchema = z.object({
  dependencyId: z.string().min(1),
  relationshipId: z.string().min(1),
  fromCommitmentId: z.string().min(1),
  toCommitmentId: z.string().min(1),
  kind: z.enum(["blocks", "requires", "supersedes"]),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  createdAt: z.string(),
});

// ---------------------------------------------------------------------------
// Contradictions, coaching, plans, recovery, ranking, and governance
// ---------------------------------------------------------------------------

export const ComparableRelationshipValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("enum"), value: z.string().min(1) }),
  z.object({ kind: z.literal("date"), value: z.string(), timezone: z.string().optional() }),
  z.object({ kind: z.literal("money"), amountMinor: z.number().int(), currency: z.string() }),
  z.object({ kind: z.literal("participant"), participantRef: z.string().min(1), role: z.string() }),
  z.object({
    kind: z.literal("sentiment"),
    value: z.enum(["positive", "neutral", "negative", "mixed"]),
  }),
]);

export const ContradictionEvidenceSideSchema = z.object({
  assertionId: z.string().min(1),
  sourceType: z.enum(["user_correction", "source_fact", "deterministic", "ai_inference"]),
  source: z.string().min(1),
  value: ComparableRelationshipValueSchema,
  validFrom: z.string(),
  validTo: z.string().optional(),
  observedAt: z.string(),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  identityConfidence: z.number().min(0).max(1).default(1),
});

export const ContradictionCaseSchema = z.object({
  caseId: z.string().min(1),
  relationshipId: z.string().min(1),
  subjectRef: z.string().min(1),
  dimension: z.string().min(1),
  status: z.enum([
    "open",
    "auto_resolved_by_authority",
    "user_resolved",
    "source_corrected",
    "deferred",
    "obsolete",
  ]),
  reason: z.string().min(1),
  sides: z.array(ContradictionEvidenceSideSchema).min(2),
  openedAt: z.string(),
  resolvedAt: z.string().optional(),
  resolutionAssertionId: z.string().optional(),
});

export const RelationshipLiveCueFrequencySchema = z.enum(["off", "minimal", "standard"]);
export const RelationshipLiveCueKindSchema = z.enum([
  "overdue_commitment",
  "unresolved_objection",
  "renewal_context",
  "missing_next_step",
  "contradiction",
  "stakeholder_gap",
  "competitor_resurfaced",
  "promise_missing_owner",
  "promise_missing_date",
]);

export const MutualActionPlanItemSchema = z.object({
  itemId: z.string().min(1),
  commitmentId: z.string().optional(),
  milestoneRef: z.string().optional(),
  title: z.string().min(1),
  ownerParticipantRef: z.string().min(1),
  dependencyItemIds: z.array(z.string()),
  dueAt: z.string().optional(),
  status: z.enum(["open", "blocked", "completed", "cancelled"]),
  evidenceRefs: z.array(z.string().min(1)).min(1),
});

export const MutualActionPlanRevisionSchema = z.object({
  revisionId: z.string().min(1),
  planId: z.string().min(1),
  version: z.number().int().positive(),
  revisionHash: z.string().min(1),
  createdAt: z.string(),
  createdBy: z.string().min(1),
  items: z.array(MutualActionPlanItemSchema).min(1),
});

export const MutualActionPlanSchema = z.object({
  planId: z.string().min(1),
  relationshipId: z.string().min(1),
  internalOwnerRef: z.string().min(1),
  counterpartyRef: z.string().min(1),
  status: z.enum([
    "draft",
    "internally_approved",
    "shared",
    "counterparty_responded",
    "active",
    "revised",
    "completed",
    "cancelled",
  ]),
  currentRevision: MutualActionPlanRevisionSchema,
  sharePolicyDecisionId: z.string().optional(),
  tokenState: z.enum(["not_issued", "active", "revoked", "expired"]),
});

export const CommitmentRecoveryClassificationSchema = z.enum([
  "fulfilled",
  "likely_fulfilled",
  "superseded",
  "blocked",
  "renegotiated",
  "forgotten",
  "unknown_stale_sources",
]);

export const CommitmentRecoveryEvaluationSchema = z.object({
  evaluationId: z.string().min(1),
  commitmentId: z.string().min(1),
  commitmentVersion: z.number().int().nonnegative(),
  recoveryWindow: z.string().min(1),
  reconcilerVersion: z.string().min(1),
  classification: CommitmentRecoveryClassificationSchema,
  evidenceRefs: z.array(z.string()),
  staleSources: z.array(z.string()),
  requiresReview: z.boolean(),
  proposedActionType: z
    .enum(["internal_task", "reminder", "escalation", "calendar_hold", "renegotiation"])
    .optional(),
  explanation: z.string().min(1),
  evaluatedAt: z.string(),
});

export const RecommendationFactorSchema = z.object({
  factor: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
  contribution: z.number().min(-20).max(20),
  reason: z.string().min(1),
});

export const RecommendationEvaluationSchema = z.object({
  evaluationId: z.string().min(1),
  recommendationId: z.string().min(1),
  rankerVersion: z.string().min(1),
  baselineScore: z.number().min(0).max(100),
  finalScore: z.number().min(0).max(100),
  factors: z.array(RecommendationFactorSchema),
  evaluatedAt: z.string(),
  sampleScope: z.enum(["cold_start", "workspace", "user"]),
});

export const ConversationPolicyLayerSchema = z.object({
  layerId: z.string().min(1),
  scope: z.enum(["organization", "workspace", "account", "user", "meeting"]),
  enforced: z.boolean().default(false),
  capture: z.enum(["deny", "require_consent", "allow"]),
  modelRoute: z.enum(["local_only", "region_restricted", "hosted_allowed"]),
  publishEvidence: z.boolean(),
  externalShare: z.boolean(),
  retentionDays: z.number().int().nonnegative(),
  redactionClasses: z.array(
    z.enum(["credentials", "financial", "health", "personal_identifier", "workspace_term"]),
  ),
  legalHold: z.boolean(),
});

export const ResolvedConversationPolicySchema = ConversationPolicyLayerSchema.omit({
  layerId: true,
  scope: true,
  enforced: true,
}).extend({
  policyVersion: z.string().min(1),
  sourceLayerIds: z.array(z.string().min(1)).min(1),
  resolvedAt: z.string(),
});

export const ConversationGovernanceDecisionSchema = z.object({
  decisionId: z.string().min(1),
  checkpoint: z.enum([
    "capture",
    "transcription",
    "semantic_enrichment",
    "evidence_publication",
    "external_share",
    "retention_deletion",
  ]),
  policyVersion: z.string().min(1),
  allowed: z.boolean(),
  route: z.enum(["none", "device", "cloud"]),
  reason: z.string().min(1),
  redactionClasses: z.array(z.string()),
  decidedAt: z.string(),
});

export const DeletionTargetOutcomeSchema = z.object({
  target: z.enum([
    "local_recording",
    "local_note",
    "outbox",
    "api_evidence",
    "embedding",
    "plan_share",
    "provider",
  ]),
  status: z.enum(["pending", "deleted", "not_found", "blocked", "failed"]),
  verificationHash: z.string().optional(),
  errorCode: z.string().optional(),
  attempts: z.number().int().nonnegative(),
});

export const ConversationDeletionReceiptSchema = z.object({
  receiptId: z.string().min(1),
  requestedAt: z.string(),
  scopeRef: z.string().min(1),
  legalHold: z.boolean(),
  status: z.enum(["pending", "blocked", "partial", "verified"]),
  targets: z.array(DeletionTargetOutcomeSchema).min(1),
  completedAt: z.string().optional(),
});

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
  batchId: z.string().optional(),
  status: ConversationReviewItemStatusSchema.optional(),
  before: z.unknown().optional(),
  proposedAfter: z.unknown().optional(),
  caveats: z.array(z.string()).optional(),
  dependentActionIds: z.array(z.string()).optional(),
  baselineVersion: z.number().int().nonnegative().optional(),
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
  kind: RelationshipLiveCueKindSchema,
  title: z.string(),
  detail: z.string(),
  severity: z.enum(["info", "attention", "critical"]),
  evidenceId: z.string().optional(),
  sourceRefs: z.array(z.string()).default([]),
  suggestedQuestion: z.string().optional(),
  triggerReason: z.string().optional(),
  createdAt: z.string().optional(),
  expiresAt: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  privacyRoute: z.enum(["device", "cloud", "deterministic"]).optional(),
  dismissalState: z.enum(["visible", "dismissed_for_meeting", "never_show_kind"]).optional(),
});

export const RelationshipIntelligenceSchema = z.object({
  claims: z.array(ConversationClaimSchema),
  reviewItems: z.array(ConversationReviewItemSchema),
  governanceReceipts: z.array(ConversationGovernanceReceiptSchema),
  delta: RelationshipDeltaSchema,
  liveCues: z.array(RelationshipLiveCueSchema),
  contradictionCases: z.array(ContradictionCaseSchema).default([]),
  recoveryEvaluations: z.array(CommitmentRecoveryEvaluationSchema).default([]),
  recommendationEvaluations: z.array(RecommendationEvaluationSchema).default([]),
  mutualActionPlans: z.array(MutualActionPlanSchema).default([]),
  effectivePolicy: ResolvedConversationPolicySchema,
  governanceDecisions: z.array(ConversationGovernanceDecisionSchema).default([]),
  deletionReceipts: z.array(ConversationDeletionReceiptSchema).default([]),
});

export const RelationshipStateSnapshotSchema = z.object({
  id: z.string(),
  version: z.number(),
  state: z.record(z.string(), z.unknown()),
  stateHash: z.string(),
  projectorVersion: z.number(),
  evaluatedAt: z.string(),
  changedDimensions: z.array(z.string()),
  assertionIds: z.array(z.string()),
  createdAt: z.string(),
});

export const RelationshipSourceStatusSchema = z.object({
  connectionId: z.string(),
  source: z.string(),
  sourceAccountId: z.string(),
  consentingActorId: z.string().optional(),
  status: z.string(),
  backfillPhase: z.string(),
  backfillCompleted: z.number().int().nonnegative(),
  backfillTotal: z.number().int().nonnegative(),
  completeness: z.string(),
  expectedCadenceSeconds: z.number().int().nonnegative(),
  lagSeconds: z.number().int().nonnegative(),
  requiredScopes: z.array(z.string()),
  grantedScopes: z.array(z.string()),
  missingScopes: z.array(z.string()),
  errorCode: z.string().optional(),
  retryCount: z.number().int().nonnegative(),
  nextRetryAt: z.string().optional(),
  syncStartedAt: z.string().optional(),
  authorizationStartedAt: z.string().optional(),
  authorizedAt: z.string().optional(),
  backfillCompletedAt: z.string().optional(),
  lastFailedSyncAt: z.string().optional(),
  disconnectedAt: z.string().optional(),
  revokedAt: z.string().optional(),
  lastSyncAt: z.string().optional(),
  lastSuccessAt: z.string().optional(),
  lastObservationAt: z.string().optional(),
  lastProviderEventAt: z.string().optional(),
  lastError: z.string().optional(),
});

export const RelationshipSourceInventoryItemSchema = z.object({
  source: z.string(),
  displayName: z.string(),
  evidence: z.array(z.string()),
  actions: z.array(z.string()),
  readScopes: z.array(z.string()),
  writeScopes: z.array(z.string()),
  scopeExplanation: z.string(),
  connectPath: z.string(),
  disconnectPath: z.string(),
  supportsReconnect: z.boolean(),
  supportsResync: z.boolean(),
  expectedCadenceSeconds: z.number().int().nonnegative(),
  accounts: z.array(RelationshipSourceStatusSchema),
});

export const BetaDiagnosticsSchema = z.object({
  schemaVersion: z.string(),
  generatedAt: z.string(),
  workspaceRef: z.string(),
  features: z.array(
    z.object({
      capability: z.string(),
      enabled: z.boolean(),
      rolloutStage: z.string(),
      reasonCode: z.string().optional(),
    }),
  ),
  sources: z.array(
    z.object({
      connectionRef: z.string(),
      source: z.string(),
      sourceAccountRef: z.string(),
      status: z.string(),
      completeness: z.string(),
      backfillPhase: z.string(),
      backfillCompleted: z.number().int().nonnegative(),
      backfillTotal: z.number().int().nonnegative(),
      lagSeconds: z.number().int().nonnegative(),
      missingScopeCount: z.number().int().nonnegative(),
      errorCode: z.string().optional(),
      retryCount: z.number().int().nonnegative(),
      lastSuccessAt: z.string().optional(),
      lastObservationAt: z.string().optional(),
      lastFailedSyncAt: z.string().optional(),
      authorizationAt: z.string().optional(),
      authorizationStartedAt: z.string().optional(),
      backfillCompletedAt: z.string().optional(),
    }),
  ),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  trustFunnel: z.array(
    z.object({ eventName: z.string(), outcome: z.string(), count: z.number().int().nonnegative() }),
  ),
  checks: z.array(
    z.object({
      code: z.string(),
      status: z.enum(["pass", "attention"]),
      explanation: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
});
export type BetaDiagnostics = z.infer<typeof BetaDiagnosticsSchema>;

export const RelationshipIdentityCandidateSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "deferred", "resolving", "resolved", "undone"]),
  candidateType: z.string(),
  version: z.number().int().positive(),
  proposedRelationship: RelationshipSchema,
  existingRelationship: RelationshipSchema,
  anchorKind: z.string(),
  anchorProvider: z.string().optional(),
  anchorPreview: z.string().optional(),
  matchingAnchors: z.array(z.string()),
  conflictingAnchors: z.array(z.string()),
  evidenceRefs: z.array(z.string()),
  evidenceCount: z.number().int().nonnegative(),
  evidenceFrom: z.string().optional(),
  evidenceTo: z.string().optional(),
  impact: z.record(z.string(), z.number()),
  recommendedDecision: z.string(),
  recommendationConfidence: z.number().min(0).max(1),
  decision: z.string().optional(),
  decisionReason: z.string().optional(),
  decisionActorId: z.string().optional(),
  decidedAt: z.string().optional(),
  decisions: z.array(
    z.object({
      id: z.string(),
      decision: z.string(),
      candidateVersion: z.number().int().positive(),
      actorId: z.string(),
      reason: z.string().optional(),
      decidedAt: z.string(),
      compensatesDecisionId: z.string().optional(),
    }),
  ),
  lineage: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      actorId: z.string(),
      reason: z.string().optional(),
      observationIds: z.array(z.string()),
      identityIds: z.array(z.string()),
      movedObjectRefs: z.array(z.string()),
      beforeRelationshipIds: z.array(z.string()),
      afterRelationshipIds: z.array(z.string()),
      occurredAt: z.string(),
    }),
  ),
});

export const RelationshipAttentionItemSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  relationshipId: z.string(),
  relationshipName: z.string(),
  reasonCode: z.enum([
    "quiet_account",
    "overdue_commitment",
    "unresolved_risk",
    "missing_next_step",
    "source_degradation",
    "action_outcome_review",
    "recommendation",
  ]),
  explanation: z.string(),
  triggeringObjectRef: z.string(),
  evidenceRefs: z.array(z.string()),
  urgencyBand: z.enum(["low", "normal", "high", "critical"]),
  rankScore: z.number().int().min(0).max(100),
  rankFactors: z.record(z.string(), z.number()),
  sourceRequirements: z.array(z.string()),
  recommendationId: z.string().optional(),
  recommendationRevision: z.number().int().nonnegative().optional(),
  ownerId: z.string().optional(),
  status: z.enum(["open", "acknowledged", "snoozed", "dismissed", "superseded", "resolved"]),
  stateReason: z.string().optional(),
  snoozedUntil: z.string().optional(),
  expiresAt: z.string().optional(),
  detectorVersion: z.number().int().positive(),
  projectorVersion: z.number().int().positive(),
  relationshipStateVersion: z.number().int().nonnegative(),
  acknowledgedBy: z.string().optional(),
  acknowledgedAt: z.string().optional(),
  dismissedBy: z.string().optional(),
  dismissedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const RelationshipSemanticMatchSchema = z.object({
  threadId: z.string(),
  subject: z.string(),
  counterparty: z.string(),
  classification: z.string(),
  summary: z.string(),
  score: z.number(),
});

export const MissionControlReadModelSchema = z.object({
  contractVersion: z.string(),
  aggregateHash: z.string(),
  asOf: z.string(),
  stateVersion: z.number().int().nonnegative(),
  stateHash: z.string(),
  projectorVersion: z.number().int().positive(),
  detectorVersion: z.number().int().positive(),
  freshnessBoundary: z.string().optional(),
  previousReviewedStateVersion: z.number().int().nonnegative(),
  changedSinceReview: z.boolean(),
  changes: z.array(
    z.object({
      dimension: z.string(),
      before: z.unknown().optional(),
      after: z.unknown().optional(),
      assertionIds: z.array(z.string()),
    }),
  ),
  evidence: z.record(
    z.string(),
    z.object({
      dimension: z.string(),
      value: z.unknown().optional(),
      supported: z.boolean(),
      missingReason: z.string().optional(),
      assertionId: z.string().optional(),
      authority: z.string().optional(),
      confidence: z.number().optional(),
      reason: z.string().optional(),
      validFrom: z.string().optional(),
      validTo: z.string().optional(),
      fresh: z.boolean(),
      evidence: z.array(
        z.object({
          observationId: z.string(),
          source: z.string(),
          observedAt: z.string(),
          evidencePath: z.string(),
          contentHash: z.string(),
        }),
      ),
    }),
  ),
  completeness: z.object({
    status: z.enum(["complete", "partial", "stale", "rebuilding", "ambiguous", "disconnected"]),
    explanation: z.string(),
    externalActionSafe: z.boolean(),
    unresolvedIdentityCount: z.number().int().nonnegative(),
    missingMaterialDimensions: z.array(z.string()),
    sources: z.array(
      z.object({
        source: z.string(),
        sourceAccountId: z.string(),
        status: z.string(),
        completeness: z.string(),
        lagSeconds: z.number(),
        expectedCadenceSeconds: z.number(),
        lastObservationAt: z.string().optional(),
        missingScopes: z.array(z.string()),
        repairPath: z.string().optional(),
      }),
    ),
  }),
  activeRecommendation: z
    .object({
      id: z.string(),
      revision: z.number().int().positive(),
      actionType: z.string(),
      channel: z.string(),
      reason: z.string(),
      rankFactors: z.record(z.string(), z.number()),
      policyStatus: z.string(),
      approvalStatus: z.string(),
      executionStatus: z.string(),
    })
    .optional(),
  pending: z.object({
    corrections: z.number().int().nonnegative(),
    identityReview: z.number().int().nonnegative(),
    approval: z.number().int().nonnegative(),
    execution: z.number().int().nonnegative(),
    reconciliation: z.number().int().nonnegative(),
  }),
  capabilities: z.record(z.string(), z.string()),
});

export const RelationshipDetailSchema = z.object({
  relationship: RelationshipSchema,
  actions: z.array(RelationshipActionSchema),
  recommendations: z.array(RelationshipActionSchema),
  participants: z.array(RelationshipParticipantSchema),
  commitments: z.array(RelationshipCommitmentSchema),
  commitmentDependencies: z.array(CommitmentDependencySchema).default([]),
  intelligence: RelationshipIntelligenceSchema.optional(),
  missionControl: MissionControlReadModelSchema,
});

// ---------------------------------------------------------------------------
// Shared relationship graph read model
// ---------------------------------------------------------------------------

export const RelationshipGraphNodeKindSchema = z.enum([
  "relationship",
  "person",
  "commitment",
  "risk",
  "milestone",
  "action",
  "evidence",
  "source",
  "note",
]);

export const RelationshipGraphEdgeKindSchema = z.enum([
  "participant_of",
  "owns",
  "has_commitment",
  "blocks",
  "requires",
  "supersedes",
  "has_risk",
  "has_milestone",
  "recommended_for",
  "supports",
  "contradicts",
  "observed_from",
  "linked_note",
]);

const RelationshipGraphTimestampSchema = z.iso.datetime({ offset: true });

export const RelationshipGraphNodeSchema = z.object({
  id: z.string().min(1),
  kind: RelationshipGraphNodeKindSchema,
  label: z.string(),
  relationshipId: z.string().optional(),
  relationshipIds: z.array(z.string()).optional().default([]),
  summary: z.string().optional(),
  status: z.string().optional(),
  role: z.string().optional(),
  source: z.string().optional(),
  lifecycle: z.string().optional(),
  engagement: z.string().optional(),
  sentiment: z.string().optional(),
  health: z.string().optional(),
  approvalStatus: z.string().optional(),
  policyStatus: z.string().optional(),
  executionStatus: z.string().optional(),
  freshness: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  dueAt: RelationshipGraphTimestampSchema.optional(),
  occurredAt: RelationshipGraphTimestampSchema.optional(),
  updatedAt: RelationshipGraphTimestampSchema.optional(),
  changedSinceReview: z.boolean().optional().default(false),
  changedDimensions: z.array(z.string()).optional().default([]),
  evidenceRefs: z.array(z.string()).optional().default([]),
  resourceRef: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const RelationshipGraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  kind: RelationshipGraphEdgeKindSchema,
  label: z.string().min(1),
  directed: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  evidenceRefs: z.array(z.string()).optional().default([]),
});

export const RelationshipGraphPermissionsSchema = z.object({
  canView: z.boolean(),
  canContribute: z.boolean(),
  canApprove: z.boolean(),
  canExecute: z.boolean(),
  canSaveViews: z.boolean(),
});

export const RelationshipGraphSchema = z.object({
  contractVersion: z.literal("2026-08-01"),
  generatedAt: RelationshipGraphTimestampSchema,
  asOf: RelationshipGraphTimestampSchema,
  historical: z.boolean(),
  scope: z.enum(["portfolio", "relationship"]),
  relationshipId: z.string().optional(),
  depth: z.number().int().min(1).max(3),
  nodes: z.array(RelationshipGraphNodeSchema),
  edges: z.array(RelationshipGraphEdgeSchema),
  permissions: RelationshipGraphPermissionsSchema,
});

export const RelationshipGraphSavedViewStateSchema = z.object({
  scope: z.enum(["portfolio", "relationship"]),
  relationshipId: z.string().optional(),
  query: z.string().default(""),
  layout: z.enum(["force", "radial", "timeline"]).default("force"),
  density: z.number().min(0.25).max(1).default(1),
  hideIsolated: z.boolean().default(false),
  selectedNodeId: z.string().optional(),
  focusDepth: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  asOf: RelationshipGraphTimestampSchema.optional(),
  changedSinceReview: z.boolean().default(false),
});

export const RelationshipGraphSavedViewSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  createdAt: RelationshipGraphTimestampSchema,
  updatedAt: RelationshipGraphTimestampSchema,
  state: RelationshipGraphSavedViewStateSchema,
});

export const RelationshipGraphSavedViewsSchema = z.array(RelationshipGraphSavedViewSchema);

export type Relationship = z.infer<typeof RelationshipSchema>;
export type RelationshipAction = z.infer<typeof RelationshipActionSchema>;
export type RelationshipPolicyDecision = z.infer<typeof RelationshipPolicyDecisionSchema>;
export type RelationshipOutcome = z.infer<typeof RelationshipOutcomeSchema>;
export type RelationshipActionRevision = z.infer<typeof RelationshipActionRevisionSchema>;
export type RelationshipActionAudit = z.infer<typeof RelationshipActionAuditSchema>;
export type RelationshipCommitment = z.infer<typeof RelationshipCommitmentSchema>;
export type RelationshipDetail = z.infer<typeof RelationshipDetailSchema>;
export type RelationshipGraphNodeKind = z.infer<typeof RelationshipGraphNodeKindSchema>;
export type RelationshipGraphEdgeKind = z.infer<typeof RelationshipGraphEdgeKindSchema>;
export type RelationshipGraphNode = z.infer<typeof RelationshipGraphNodeSchema>;
export type RelationshipGraphEdge = z.infer<typeof RelationshipGraphEdgeSchema>;
export type RelationshipGraphPermissions = z.infer<typeof RelationshipGraphPermissionsSchema>;
export type RelationshipGraph = z.infer<typeof RelationshipGraphSchema>;
export type RelationshipGraphSavedViewState = z.infer<typeof RelationshipGraphSavedViewStateSchema>;
export type RelationshipGraphSavedView = z.infer<typeof RelationshipGraphSavedViewSchema>;
export type MissionControlReadModel = z.infer<typeof MissionControlReadModelSchema>;
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
export type RelationshipSourceInventoryItem = z.infer<typeof RelationshipSourceInventoryItemSchema>;
export type RelationshipIdentityCandidate = z.infer<typeof RelationshipIdentityCandidateSchema>;
export type RelationshipAttentionItem = z.infer<typeof RelationshipAttentionItemSchema>;
export type RelationshipSemanticMatch = z.infer<typeof RelationshipSemanticMatchSchema>;
export type ConversationSegment = z.infer<typeof ConversationSegmentSchema>;
export type ConversationGovernanceReceipt = z.infer<typeof ConversationGovernanceReceiptSchema>;
export type CanonicalTranscriptEnvelope = z.infer<typeof CanonicalTranscriptEnvelopeSchema>;
export type ConversationClaim = z.infer<typeof ConversationClaimSchema>;
export type ConversationClaimKind = z.infer<typeof ConversationClaimKindSchema>;
export type ConversationExtractionRouting = z.infer<typeof ConversationExtractionRoutingSchema>;
export type ConversationExtractionProvenance = z.infer<
  typeof ConversationExtractionProvenanceSchema
>;
export type ConversationEvidenceSpan = z.infer<typeof ConversationEvidenceSpanSchema>;
export type ConversationNormalizedValue = z.infer<typeof ConversationNormalizedValueSchema>;
export type ConversationClaimCandidate = z.infer<typeof ConversationClaimCandidateSchema>;
export type ConversationCandidateRejection = z.infer<typeof ConversationCandidateRejectionSchema>;
export type BoundedRelationshipContext = z.infer<typeof BoundedRelationshipContextSchema>;
export type ConversationExtractionRequest = z.infer<typeof ConversationExtractionRequestSchema>;
export type ConversationExtractionResult = z.infer<typeof ConversationExtractionResultSchema>;
export type ConversationReviewBatch = z.infer<typeof ConversationReviewBatchSchema>;
export type ConversationReviewBatchItem = z.infer<typeof ConversationReviewBatchItemSchema>;
export type ConversationReviewDecision = z.infer<typeof ConversationReviewDecisionSchema>;
export type ConversationReviewDecisionKind = z.infer<typeof ConversationReviewDecisionKindSchema>;
export type CommitmentEvent = z.infer<typeof CommitmentEventSchema>;
export type CommitmentEventKind = z.infer<typeof CommitmentEventKindSchema>;
export type CommitmentProjection = z.infer<typeof CommitmentProjectionSchema>;
export type CommitmentDependency = z.infer<typeof CommitmentDependencySchema>;
export type ComparableRelationshipValue = z.infer<typeof ComparableRelationshipValueSchema>;
export type ContradictionEvidenceSide = z.infer<typeof ContradictionEvidenceSideSchema>;
export type ContradictionCase = z.infer<typeof ContradictionCaseSchema>;
export type RelationshipLiveCueFrequency = z.infer<typeof RelationshipLiveCueFrequencySchema>;
export type RelationshipLiveCueKind = z.infer<typeof RelationshipLiveCueKindSchema>;
export type MutualActionPlanItem = z.infer<typeof MutualActionPlanItemSchema>;
export type MutualActionPlanRevision = z.infer<typeof MutualActionPlanRevisionSchema>;
export type MutualActionPlan = z.infer<typeof MutualActionPlanSchema>;
export type CommitmentRecoveryEvaluation = z.infer<typeof CommitmentRecoveryEvaluationSchema>;
export type CommitmentRecoveryClassification = z.infer<
  typeof CommitmentRecoveryClassificationSchema
>;
export type RecommendationFactor = z.infer<typeof RecommendationFactorSchema>;
export type RecommendationEvaluation = z.infer<typeof RecommendationEvaluationSchema>;
export type ConversationPolicyLayer = z.infer<typeof ConversationPolicyLayerSchema>;
export type ResolvedConversationPolicy = z.infer<typeof ResolvedConversationPolicySchema>;
export type ConversationGovernanceDecision = z.infer<typeof ConversationGovernanceDecisionSchema>;
export type ConversationDeletionReceipt = z.infer<typeof ConversationDeletionReceiptSchema>;
export type ConversationActionProposal = z.infer<typeof ConversationActionProposalSchema>;
export type ConversationReviewItem = z.infer<typeof ConversationReviewItemSchema>;
export type RelationshipDelta = z.infer<typeof RelationshipDeltaSchema>;
export type RelationshipLiveCue = z.infer<typeof RelationshipLiveCueSchema>;
export type RelationshipIntelligence = z.infer<typeof RelationshipIntelligenceSchema>;
