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
  | "meeting_follow_up";

export type Detector =
  | "requested_follow_up_due"
  | "unanswered_proposal"
  | "waiting_on_me"
  | "dormant_warm_opportunity"
  | "neglected_referral"
  | "former_customer_reconnect"
  | "manual";

export type Channel = "email" | "slack" | "call" | "crm_task";
export type QueueStatus = "open" | "snoozed" | "dismissed" | "handled";
export type PolicyStatus = "pending" | "passed" | "review_required" | "blocked" | "stale";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ExecutionStatus =
  | "pending"
  | "requested"
  | "sent"
  | "failed"
  | "ambiguous"
  | "cancelled";
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
}

export type RelationshipKind =
  | "person"
  | "company"
  | "customer"
  | "opportunity"
  | "referral"
  | "partner";

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
  | "bad_recommendation";

export interface RevenueOutcome {
  id: string;
  kind: OutcomeKind;
  source: "gmail" | "calendar" | "crm" | "user" | "outbound";
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
}

export interface DetectorStat {
  detector: string;
  surfaced: number;
  handled: number;
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
