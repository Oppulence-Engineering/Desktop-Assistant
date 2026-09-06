// Types for the RFC 030 Revenue Memory & Outbound Governance API, mirrored
// from apps/rowboat-api's OpenAPI contract. The dashboard talks to these
// through the same-origin proxy (/api/rowboat/v1/...), so no generated SDK is
// needed — these keep the UI type-safe against the contract.

import { z } from "zod";

export type WorkspaceMode = "local" | "linked";
export type WorkspaceStatus = "active" | "disconnected" | "repair_required";

export interface RevenueWorkspace {
  id: string;
  mode: WorkspaceMode;
  status: WorkspaceStatus;
  outboundOrganizationId?: string;
  outboundWorkspaceId?: string;
  lastVerifiedAt?: string;
  preflightAvailable: boolean;
}

export type ActionType =
  | "warm_follow_up"
  | "proposal_nudge"
  | "referral_reconnect"
  | "customer_risk"
  | "meeting_follow_up"
  | "meeting_recap"
  | "crm_update"
  | "follow_up_task"
  | "calendar_hold"
  | "commitment_rescue";

export type Detector =
  | "requested_follow_up_due"
  | "unanswered_proposal"
  | "waiting_on_me"
  | "dormant_warm_opportunity"
  | "neglected_referral"
  | "former_customer_reconnect"
  | "conversation_action_pack"
  | "commitment_due"
  | "manual";

export type Channel = "email" | "slack" | "call" | "crm_task" | "crm" | "task" | "calendar";
export type QueueStatus = "open" | "snoozed" | "dismissed" | "handled";
export type PolicyStatus = "pending" | "passed" | "review_required" | "blocked" | "stale";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ExecutionStatus =
  "pending" | "requested" | "sent" | "failed" | "ambiguous" | "cancelled";
export type ExecutionMode = "draft" | "send";

export interface RevenueAction {
  id: string;
  relationshipId?: string;
  actionType: ActionType;
  channel: Channel;
  detector: Detector;
  revision: number;
  revisionHash: string;
  // The evidence-backed reason (free text at runtime).
  reason: string;
  recipientEmail?: string;
  proposedSubject?: string;
  proposedMessage?: string;
  senderAccountRef?: string;
  priorityScore: number;
  priorityComponents?: Record<string, number>;
  queueStatus: QueueStatus;
  policyStatus: PolicyStatus;
  approvalStatus: ApprovalStatus;
  executionStatus: ExecutionStatus;
  executionOwner: "rowboat" | "outbound";
  executionMode: ExecutionMode;
  approvedRevision?: number;
  approvedAt?: string;
  providerMessageId?: string;
  providerThreadId?: string;
  executedAt?: string;
  executionError?: string;
  reconciliationStatus?: "pending" | "found" | "not_found" | "error" | "manual_review";
  reconciliationAttempts?: number;
  reconciliationCheckedAt?: string;
  reconciliationNextAt?: string;
  reconciliationError?: string;
  dismissReason?: string;
  snoozedUntil?: string;
  dueAt?: string;
  createdAt: string;
  updatedAt: string;
  evidence: Array<{
    id: string;
    source: string;
    sourceRecordId: string;
    excerpt?: string;
    occurredAt: string;
    externalEvidenceRefs: string[];
  }>;
}

export type RelationshipKind =
  "person" | "company" | "customer" | "opportunity" | "referral" | "partner";

export type RelationshipLifecycle =
  | "prospect"
  | "evaluation"
  | "contracting"
  | "onboarding"
  | "active_customer"
  | "renewal"
  | "churned"
  | "former_customer";
export type RelationshipEngagement = "unknown" | "increasing" | "steady" | "declining" | "dormant";
export type RelationshipSentiment = "unknown" | "positive" | "mixed" | "negative";
export type RelationshipHealth = "unknown" | "healthy" | "needs_attention" | "critical";

export interface RevenueRelationship {
  id: string;
  kind: RelationshipKind;
  displayName: string;
  primaryEmail?: string;
  accountDomain?: string;
  summary?: string;
  status: "active" | "dormant" | "closed" | "archived";
  lastTouchAt?: string;
  nextActionAt?: string;
  openActions?: number;
  peopleCount?: number;
  emailThreadCount?: number;
  commitmentCount?: number;
  nextAction?: string;
  lifecycle: RelationshipLifecycle;
  engagement: RelationshipEngagement;
  sentiment: RelationshipSentiment;
  health: RelationshipHealth;
  stateReason?: string;
  stateVersion: number;
  stateHash?: string;
  projectorVersion: number;
  projectedAt?: string;
  lastChangedAt?: string;
  risks: string[];
  milestones: string[];
  resourceRefs: string[];
  categories: string[];
  companyDescription?: string;
  linkedinUrl?: string;
  companyEnrichmentRefs?: Record<string, string[]>;
  companyEnrichedAt?: string;
}

export interface RelationshipParticipant {
  id: string;
  displayName: string;
  email?: string;
  role: string;
  title?: string;
  active: boolean;
  externalRefs: string[];
  personId?: string;
  person?: RelationshipPerson;
}

export interface RelationshipPerson {
  id: string;
  displayName: string;
  aliases: string[];
  primaryEmail?: string;
  title?: string;
  orgName?: string;
  orgDomain?: string;
  timezone?: string;
  locale?: string;
  seniority?: string;
  location?: string;
  status: string;
  employmentStatus?: "unknown" | "active" | "departed";
  relationshipCount: number;
  firstInteractionAt?: string;
  lastInteractionAt?: string;
  attributesVersion: number;
}

export interface RelationshipPersonAttribute {
  id: string;
  dimension: string;
  value: string;
  sourceType: string;
  source: string;
  extractor: string;
  status: string;
  confidence: number;
  reason?: string;
  observedAt: string;
  validFrom: string;
  validTo?: string;
  citations?: Array<{
    title?: string;
    url: string;
    excerpts?: string[];
  }>;
}

export interface ResearchConsentState {
  consented: boolean;
  consentedAt?: string;
}

export interface ResearchStatus {
  available: boolean;
  allowed: boolean;
  reason?: string;
  requiredPlan: string;
  consent: ResearchConsentState;
}

export interface ResearchEstimate {
  people?: number;
  companies?: number;
  processor: string;
  credits: number;
  usd: number;
  batchSize: number;
}

export interface CompanyResearchOutcome {
  relationshipId: string;
  matched: boolean;
  runId?: string;
  written: number;
  rejected?: string[];
  replayed: boolean;
}

export interface PersonResearchOutcome {
  personId: string;
  matched: boolean;
  runId?: string;
  written: number;
  rejected?: string[];
  replayed: boolean;
}

export interface PersonDeletionReceipt {
  receiptId: string;
  personId: string;
  requestedAt: string;
  completedAt: string;
  reason: string;
  suppressedIdentities: number;
  attributesDeleted: number;
  identitiesDeleted: number;
  interactionStatsDeleted: number;
  mergeCandidatesDeleted: number;
}

export interface RelationshipCommitment {
  id: string;
  direction: string;
  text: string;
  status: string;
  dueAt?: string;
  confidence: number;
  userConfirmed: boolean;
  ownerParticipantRef?: string;
  counterpartyParticipantRef?: string;
  beneficiaryParticipantRef?: string;
  sourcePhrase?: string;
  duePhrase?: string;
  dueTimezone?: string;
  acceptance?: "candidate" | "internally_confirmed" | "offered" | "accepted" | "disputed";
  blocker?: string;
  completedAt?: string;
  currentEventVersion?: number;
}

export interface RelationshipObservation {
  id: string;
  source: string;
  sourceAccountId?: string;
  externalId: string;
  sourceVersion: string;
  eventType: string;
  occurredAt: string;
  receivedAt: string;
  summary?: string;
  normalizedFacts: Record<string, unknown>;
  contentHash: string;
}

export interface RelationshipObservationInput {
  relationshipId?: string;
  displayName?: string;
  primaryEmail?: string;
  accountDomain?: string;
  source: string;
  sourceAccountId?: string;
  externalId: string;
  sourceVersion?: string;
  eventType: string;
  occurredAt: string;
  receivedAt?: string;
  summary?: string;
  normalizedFacts: Record<string, unknown>;
  payload?: unknown;
  participants?: Array<{
    displayName: string;
    email?: string;
    role?: string;
    title?: string;
    externalRefs?: string[];
  }>;
  assertions?: Array<{
    dimension: string;
    value: string;
    sourceType: string;
    confidence: number;
    reason: string;
    validFrom: string;
  }>;
}

export interface RelationshipStateSnapshot {
  id: string;
  version: number;
  state: Record<string, unknown>;
  stateHash: string;
  projectorVersion: number;
  evaluatedAt: string;
  changedDimensions: string[];
  assertionIds: string[];
  createdAt: string;
}

export interface RelationshipSourceStatus {
  connectionId: string;
  source: string;
  sourceAccountId: string;
  consentingActorId?: string;
  status: string;
  backfillPhase: string;
  backfillCompleted: number;
  backfillTotal: number;
  completeness: string;
  expectedCadenceSeconds: number;
  lagSeconds: number;
  requiredScopes: string[];
  grantedScopes: string[];
  missingScopes: string[];
  errorCode?: string;
  retryCount: number;
  nextRetryAt?: string;
  syncStartedAt?: string;
  authorizationStartedAt?: string;
  authorizedAt?: string;
  backfillCompletedAt?: string;
  lastFailedSyncAt?: string;
  disconnectedAt?: string;
  revokedAt?: string;
  lastSyncAt?: string;
  lastSuccessAt?: string;
  lastObservationAt?: string;
  lastProviderEventAt?: string;
  lastError?: string;
}

export interface RelationshipSourceInventoryItem {
  source: string;
  displayName: string;
  evidence: string[];
  actions: string[];
  readScopes: string[];
  writeScopes: string[];
  scopeExplanation: string;
  connectPath: string;
  disconnectPath: string;
  supportsReconnect: boolean;
  supportsResync: boolean;
  expectedCadenceSeconds: number;
  accounts: RelationshipSourceStatus[];
}

export interface BetaDiagnostics {
  schemaVersion: string;
  generatedAt: string;
  workspaceRef: string;
  features: Array<{
    capability: string;
    enabled: boolean;
    rolloutStage: string;
    reasonCode?: string;
  }>;
  sources: Array<{
    connectionRef: string;
    source: string;
    sourceAccountRef: string;
    status: string;
    completeness: string;
    backfillPhase: string;
    backfillCompleted: number;
    backfillTotal: number;
    lagSeconds: number;
    missingScopeCount: number;
    errorCode?: string;
    retryCount: number;
    lastSuccessAt?: string;
    lastObservationAt?: string;
    lastFailedSyncAt?: string;
    authorizationAt?: string;
    authorizationStartedAt?: string;
    backfillCompletedAt?: string;
  }>;
  counts: Record<string, number>;
  trustFunnel: Array<{ eventName: string; outcome: string; count: number }>;
  checks: Array<{
    code: string;
    status: "pass" | "attention";
    explanation: string;
    count: number;
  }>;
}

export interface RelationshipIdentityCandidate {
  id: string;
  status: "pending" | "deferred" | "resolving" | "resolved" | "undone";
  candidateType: string;
  version: number;
  proposedRelationship: RevenueRelationship;
  existingRelationship: RevenueRelationship;
  anchorKind: string;
  anchorProvider?: string;
  anchorPreview?: string;
  matchingAnchors: string[];
  conflictingAnchors: string[];
  evidenceRefs: string[];
  evidenceCount: number;
  evidenceFrom?: string;
  evidenceTo?: string;
  impact: Record<string, number>;
  recommendedDecision: string;
  recommendationConfidence: number;
  decision?: string;
  decisionReason?: string;
  decisionActorId?: string;
  decidedAt?: string;
  decisions: Array<{
    id: string;
    decision: string;
    candidateVersion: number;
    actorId: string;
    reason?: string;
    decidedAt: string;
    compensatesDecisionId?: string;
  }>;
  lineage: Array<{
    id: string;
    kind: string;
    actorId: string;
    reason?: string;
    observationIds: string[];
    identityIds: string[];
    movedObjectRefs: string[];
    beforeRelationshipIds: string[];
    afterRelationshipIds: string[];
    occurredAt: string;
  }>;
}

export interface RelationshipAttentionItem {
  id: string;
  version: number;
  relationshipId: string;
  relationshipName: string;
  reasonCode:
    | "quiet_account"
    | "overdue_commitment"
    | "unresolved_risk"
    | "missing_next_step"
    | "source_degradation"
    | "action_outcome_review"
    | "recommendation"
    | "contact_departed";
  explanation: string;
  triggeringObjectRef: string;
  evidenceRefs: string[];
  urgencyBand: "low" | "normal" | "high" | "critical";
  rankScore: number;
  rankFactors: Record<string, number>;
  sourceRequirements: string[];
  recommendationId?: string;
  recommendationRevision?: number;
  ownerId?: string;
  status: "open" | "acknowledged" | "snoozed" | "dismissed" | "superseded" | "resolved";
  stateReason?: string;
  snoozedUntil?: string;
  expiresAt?: string;
  detectorVersion: number;
  projectorVersion: number;
  relationshipStateVersion: number;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  dismissedBy?: string;
  dismissedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type ScanStatus = "pending" | "running" | "completed" | "failed";

export interface RevenueLeakScan {
  id: string;
  status: ScanStatus;
  mode: WorkspaceMode;
  lookbackDays: number;
  threadsSeen?: number;
  candidatesSeen?: number;
  relationshipsCreated?: number;
  evidencesCreated?: number;
  actionsCreated?: number;
  startedAt?: string;
  completedAt?: string;
  sourceFreshnessAt?: string;
  error?: string;
}

export interface RevenuePolicyDecision {
  id: string;
  revision: number;
  revisionHash: string;
  status: "passed" | "review_required" | "blocked";
  reasonCodes?: string[];
  verification?: Record<string, unknown>;
  suppression?: Record<string, unknown>;
  research?: Record<string, unknown>;
  crm?: Record<string, unknown>;
  evaluatedAt: string;
  expiresAt: string;
}

export type OutcomeKind =
  | "sent"
  | "delivered"
  | "bounced"
  | "replied"
  | "meeting_booked"
  | "won"
  | "lost"
  | "dismissed"
  | "bad_recommendation"
  | "deal_advanced"
  | "onboarding_progressed"
  | "renewed"
  | "escalated"
  | "churned"
  | "corrected";

export interface RevenueOutcome {
  id: string;
  kind: OutcomeKind;
  source: "gmail" | "calendar" | "crm" | "user" | "outbound" | "slack" | "meeting" | "task";
  sourceEventId: string;
  occurredAt: string;
}

export interface ActionRevisionSnapshot {
  revision: number;
  revisionHash: string;
  actionType: string;
  channel: string;
  createdAt: string;
}

export interface ActionAudit {
  action: RevenueAction;
  revisions: ActionRevisionSnapshot[];
  decisions: RevenuePolicyDecision[];
  outcomes: RevenueOutcome[];
}

export interface RelationshipDetail {
  relationship: RevenueRelationship;
  actions: RevenueAction[];
  recommendations: RevenueAction[];
  participants: RelationshipParticipant[];
  emailThreads: Array<{
    id: string;
    subject?: string;
    counterpartyEmail?: string;
    replyState: "needs_reply" | "awaiting_reply" | "quiet";
    lastDirection?: "inbound" | "outbound";
    lastActivityAt?: string;
    messageCount: number;
  }>;
  commitments: RelationshipCommitment[];
  commitmentDependencies: CommitmentDependency[];
  intelligence?: RelationshipIntelligence;
  missionControl: MissionControlReadModel;
}

export interface MissionControlEvidenceReference {
  observationId: string;
  source: string;
  observedAt: string;
  evidencePath: string;
  contentHash: string;
}

export interface MissionControlDimensionEvidence {
  dimension: string;
  value?: unknown;
  supported: boolean;
  missingReason?: string;
  assertionId?: string;
  authority?: string;
  authorityRank?: number;
  status?: "proposed" | "accepted" | "rejected" | "superseded" | "retracted" | "expired" | "active";
  confidence?: number;
  reason?: string;
  valueSchemaVersion?: number;
  extractorVersion?: string;
  projectorCompatVersion?: number;
  reviewerId?: string;
  reviewDecision?: "accepted" | "rejected";
  reviewedAt?: string;
  validFrom?: string;
  validTo?: string;
  fresh: boolean;
  evidence: MissionControlEvidenceReference[];
}

export interface MissionControlReadModel {
  contractVersion: string;
  aggregateHash: string;
  asOf: string;
  stateVersion: number;
  stateHash: string;
  projectorVersion: number;
  detectorVersion: number;
  freshnessBoundary?: string;
  previousReviewedStateVersion: number;
  changedSinceReview: boolean;
  changes: Array<{ dimension: string; before?: unknown; after?: unknown; assertionIds: string[] }>;
  evidence: Record<string, MissionControlDimensionEvidence>;
  completeness: {
    status: "complete" | "partial" | "stale" | "rebuilding" | "ambiguous" | "disconnected";
    explanation: string;
    externalActionSafe: boolean;
    unresolvedIdentityCount: number;
    missingMaterialDimensions: string[];
    sources: Array<{
      source: string;
      sourceAccountId: string;
      status: string;
      completeness: string;
      lagSeconds: number;
      expectedCadenceSeconds: number;
      lastObservationAt?: string;
      missingScopes: string[];
      repairPath?: string;
    }>;
  };
  activeRecommendation?: {
    id: string;
    revision: number;
    actionType: string;
    channel: string;
    reason: string;
    rankFactors: Record<string, number>;
    policyStatus: string;
    approvalStatus: string;
    executionStatus: string;
  };
  pending: {
    corrections: number;
    identityReview: number;
    approval: number;
    execution: number;
    reconciliation: number;
  };
  capabilities: Record<string, string>;
}

export interface CommitmentDependency {
  dependencyId: string;
  relationshipId: string;
  fromCommitmentId: string;
  toCommitmentId: string;
  kind: "blocks" | "requires" | "supersedes";
  evidenceRefs: string[];
  createdAt: string;
}

export interface ConversationClaim {
  id: string;
  kind:
    | "risk"
    | "objection"
    | "decision"
    | "milestone"
    | "sentiment"
    | "stakeholder"
    | "lifecycle"
    | "commitment";
  value: string;
  exactQuote: string;
  startMs: number;
  endMs: number;
  speakerId: string;
  speakerLabel: string;
  speakerConfidence: number;
  confidence: number;
  captureCaveats: string[];
  material: boolean;
  stateDimension?: string;
  observationId?: string;
}

export interface ConversationReviewItem {
  id: string;
  kind: "word" | "speaker" | "entity" | "claim" | "capture";
  label: string;
  currentValue: string;
  confidence: number;
  observationId: string;
  claimId?: string;
  stateDimension?: string;
  exactQuote?: string;
  batchId?: string;
  status?: "pending_review" | "accepted" | "corrected" | "rejected" | "deferred";
  before?: unknown;
  proposedAfter?: unknown;
  caveats?: string[];
  dependentActionIds?: string[];
  baselineVersion?: number;
}

export interface RelationshipDelta {
  fromVersion: number;
  toVersion: number;
  changes: Array<{
    dimension: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
    assertionIds: string[];
  }>;
  uncertainClaimIds: string[];
  contradictions: Array<{
    dimension: string;
    currentValue: string;
    contradictedValue: string;
    currentAssertionId: string;
    contradictedAssertionId: string;
  }>;
  recommendationReason?: string;
}

export interface RelationshipLiveCue {
  id: string;
  kind:
    | "overdue_commitment"
    | "unresolved_objection"
    | "renewal_context"
    | "missing_next_step"
    | "contradiction"
    | "stakeholder_gap"
    | "competitor_resurfaced"
    | "promise_missing_owner"
    | "promise_missing_date";
  title: string;
  detail: string;
  severity: "info" | "attention" | "critical";
  evidenceId?: string;
  sourceRefs?: string[];
  suggestedQuestion?: string;
  triggerReason?: string;
  createdAt?: string;
  expiresAt?: string;
  confidence?: number;
  privacyRoute?: "device" | "cloud" | "deterministic";
  dismissalState?: "visible" | "dismissed_for_meeting" | "never_show_kind";
}

export interface RelationshipIntelligence {
  claims: ConversationClaim[];
  reviewItems: ConversationReviewItem[];
  governanceReceipts: Array<{
    receiptId: string;
    capturedAt: string;
    capturePolicy: string;
    routing: string;
    region: string;
    retention: string;
    participantDisclosure: string;
    legalHold: boolean;
    deletionOutcome: string;
    evidenceClip: "not_retained" | "encrypted";
  }>;
  delta: RelationshipDelta;
  liveCues: RelationshipLiveCue[];
  contradictionCases: Array<{
    caseId: string;
    relationshipId: string;
    subjectRef: string;
    dimension: string;
    status:
      | "open"
      | "auto_resolved_by_authority"
      | "user_resolved"
      | "source_corrected"
      | "deferred"
      | "obsolete";
    reason: string;
    sides: Array<{
      assertionId: string;
      sourceType: string;
      source: string;
      value: { kind: string; value?: string };
      validFrom: string;
      observedAt: string;
      evidenceRefs: string[];
      identityConfidence: number;
    }>;
    openedAt: string;
    resolvedAt?: string;
  }>;
  recoveryEvaluations: Array<{
    evaluationId: string;
    commitmentId: string;
    commitmentVersion: number;
    recoveryWindow: string;
    reconcilerVersion: string;
    classification: string;
    evidenceRefs: string[];
    staleSources: string[];
    requiresReview: boolean;
    proposedActionType?: string;
    explanation: string;
    evaluatedAt: string;
  }>;
  recommendationEvaluations: Array<{
    evaluationId: string;
    recommendationId: string;
    rankerVersion: string;
    baselineScore: number;
    finalScore: number;
    factors: Array<{
      factor: string;
      value: string | number | boolean;
      contribution: number;
      reason: string;
    }>;
    evaluatedAt: string;
    sampleScope: "cold_start" | "workspace" | "user";
  }>;
  mutualActionPlans: Array<{
    planId: string;
    relationshipId: string;
    internalOwnerRef: string;
    counterpartyRef: string;
    status: string;
    currentRevision: {
      revisionId: string;
      planId: string;
      version: number;
      revisionHash: string;
      createdAt: string;
      createdBy: string;
      items: Array<{
        itemId: string;
        commitmentId?: string;
        milestoneRef?: string;
        title: string;
        ownerParticipantRef: string;
        dependencyItemIds: string[];
        dueAt?: string;
        status: string;
        evidenceRefs: string[];
      }>;
    };
    sharePolicyDecisionId?: string;
    tokenState: string;
  }>;
  effectivePolicy: {
    capture: "deny" | "require_consent" | "allow";
    modelRoute: "local_only" | "region_restricted" | "hosted_allowed";
    publishEvidence: boolean;
    externalShare: boolean;
    retentionDays: number;
    redactionClasses: string[];
    legalHold: boolean;
    policyVersion: string;
    sourceLayerIds: string[];
    resolvedAt: string;
  };
  governanceDecisions: Array<{
    decisionId: string;
    checkpoint: string;
    policyVersion: string;
    allowed: boolean;
    route: "none" | "device" | "cloud";
    reason: string;
    redactionClasses: string[];
    decidedAt: string;
  }>;
  deletionReceipts: Array<{
    receiptId: string;
    requestedAt: string;
    scopeRef: string;
    legalHold: boolean;
    status: "pending" | "blocked" | "partial" | "verified";
    targets: Array<{
      target: string;
      status: "pending" | "deleted" | "not_found" | "blocked" | "failed";
      verificationHash?: string;
      errorCode?: string;
      attempts: number;
    }>;
    completedAt?: string;
  }>;
}

export interface DetectorStat {
  detector: string;
  surfaced: number;
  handled: number;
}

export interface DigestAction {
  detector: string;
  recipient: string;
  reason: string;
  priority: number;
}

export interface RevenueDigest {
  generatedAt: string;
  openCount: number;
  replied: number;
  meetingsBooked: number;
  handled: number;
  top: DigestAction[];
}

export interface RevenueImpact {
  surfaced: number;
  open: number;
  handled: number;
  snoozed: number;
  dismissed: number;
  approved: number;
  executed: number;
  replied: number;
  meetingsBooked: number;
  won: number;
  lost: number;
  replyRate: number | null;
  meetingRate: number | null;
  outcomes: Record<string, number>;
  byDetector: DetectorStat[];
}

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

export type RelationshipGraphNodeKind = z.infer<typeof RelationshipGraphNodeKindSchema>;
export type RelationshipGraphEdgeKind = z.infer<typeof RelationshipGraphEdgeKindSchema>;
export type RelationshipGraphNode = z.infer<typeof RelationshipGraphNodeSchema>;
export type RelationshipGraphEdge = z.infer<typeof RelationshipGraphEdgeSchema>;
export type RelationshipGraphPermissions = z.infer<typeof RelationshipGraphPermissionsSchema>;
export type RelationshipGraph = z.infer<typeof RelationshipGraphSchema>;
export type RelationshipGraphSavedViewState = z.infer<typeof RelationshipGraphSavedViewStateSchema>;
export type RelationshipGraphSavedView = z.infer<typeof RelationshipGraphSavedViewSchema>;
