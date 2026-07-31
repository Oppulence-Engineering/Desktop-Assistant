// Types for the RFC 030 Revenue Memory & Outbound Governance API, mirrored
// from apps/rowboat-api's OpenAPI contract. The dashboard talks to these
// through the same-origin proxy (/api/rowboat/v1/...), so no generated SDK is
// needed — these keep the UI type-safe against the contract.

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
  nextAction?: string;
  lifecycle: RelationshipLifecycle;
  engagement: RelationshipEngagement;
  sentiment: RelationshipSentiment;
  health: RelationshipHealth;
  stateReason?: string;
  stateVersion: number;
  lastChangedAt?: string;
  risks: string[];
  milestones: string[];
}

export interface RelationshipParticipant {
  id: string;
  displayName: string;
  email?: string;
  role: string;
  title?: string;
  active: boolean;
  externalRefs: string[];
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

export interface RelationshipStateSnapshot {
  id: string;
  version: number;
  state: Record<string, unknown>;
  changedDimensions: string[];
  assertionIds: string[];
  createdAt: string;
}

export interface RelationshipSourceStatus {
  source: string;
  sourceAccountId: string;
  status: string;
  lastSuccessAt?: string;
  lastObservationAt?: string;
  lastError?: string;
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
  commitments: RelationshipCommitment[];
  commitmentDependencies: CommitmentDependency[];
  intelligence?: RelationshipIntelligence;
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
    status: "open" | "auto_resolved_by_authority" | "user_resolved" | "source_corrected" | "deferred" | "obsolete";
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
    factors: Array<{ factor: string; value: string | number | boolean; contribution: number; reason: string }>;
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
