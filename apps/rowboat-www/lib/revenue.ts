"use client";

import "client-only";

// Client for the Revenue Action Queue (RFC 030). Every call goes through the
// same-origin dashboard proxy, which attaches the rowboat-api bearer token
// server-side and bounces the browser back through WorkOS on a 401.

import { dashboardFetch, toDashboardAPIPath } from "@/lib/auth/client";
import { RelationshipGraphSchema } from "@/types/revenue";
import type {
  ActionAudit,
  RelationshipDetail,
  RevenueAction,
  RevenueDigest,
  RevenueImpact,
  RevenueLeakScan,
  RevenueOutcome,
  RevenuePolicyDecision,
  RevenueRelationship,
  RevenueWorkspace,
  RelationshipObservation,
  RelationshipObservationInput,
  RelationshipIdentityCandidate,
  RelationshipAttentionItem,
  RelationshipSourceInventoryItem,
  RelationshipSourceStatus,
  BetaDiagnostics,
  RelationshipGraph,
  RelationshipStateSnapshot,
} from "@/types/revenue";

export class RevenueAPIError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "RevenueAPIError";
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await dashboardFetch(toDashboardAPIPath(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = await res.json();
      detail = body.detail || body.title || detail;
      code = body.code;
    } catch {
      // non-JSON error body; keep the status-based message
    }
    throw new RevenueAPIError(detail, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const post = (path: string, body?: unknown) =>
  call(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

// --- workspace ---------------------------------------------------------------

export const getWorkspace = () => call<RevenueWorkspace>("/revenue-workspaces/current");

export const getImpact = () => call<RevenueImpact>("/revenue-impact");

export const getDigest = () => call<RevenueDigest>("/revenue-digest");

export interface SemanticMatch {
  threadId: string;
  subject: string;
  counterparty: string;
  classification: string;
  summary: string;
  score: number;
}

// semanticSearch runs a natural-language search over the mail signals (RFC 031
// Layer 2). `available` is false when semantic memory isn't configured.
export async function semanticSearch(
  query: string,
): Promise<{ available: boolean; matches: SemanticMatch[] }> {
  const params = new URLSearchParams({ q: query });
  const body = await call<{ available: boolean; matches: SemanticMatch[] }>(
    `/revenue-search?${params.toString()}`,
  );
  return { available: body.available, matches: body.matches ?? [] };
}

// --- billing (upgrade to act) ------------------------------------------------

// startCheckout opens a Stripe Checkout session for the given plan and returns
// the URL to redirect to. Acting on actions (approve/execute) is gated behind
// a paid plan; reading, scanning, and drafting stay free.
export async function startCheckout(plan: "starter" | "pro"): Promise<string> {
  const body = await call<{ url: string }>("/billing/checkout-session", {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
  return body.url;
}

export interface LinkWorkspaceInput {
  outboundOrganizationId?: string;
  outboundWorkspaceId: string;
}

export const linkWorkspace = (input: LinkWorkspaceInput) =>
  post("/revenue-workspaces/link", input) as Promise<RevenueWorkspace>;

// --- scan --------------------------------------------------------------------

export const startScan = (lookbackDays?: number) =>
  post(
    "/revenue-leak-scans",
    lookbackDays ? { lookbackDays } : undefined,
  ) as Promise<RevenueLeakScan>;

export const getScan = (scanId: string, signal?: AbortSignal) =>
  call<RevenueLeakScan>(`/revenue-leak-scans/${scanId}`, { signal });

// Scan history is not a server list endpoint; the panel keeps its own record of
// scans it started this session and re-hydrates each by id.
export async function getScans(ids: string[]): Promise<RevenueLeakScan[]> {
  const rows = await Promise.all(ids.map((id) => getScan(id).catch(() => null)));
  return rows.filter((r): r is RevenueLeakScan => r !== null);
}

// --- queue reads -------------------------------------------------------------

export async function listActions(queueStatus = "open", limit = 25): Promise<RevenueAction[]> {
  const params = new URLSearchParams({ queueStatus, limit: String(limit) });
  const body = await call<{ actions: RevenueAction[] }>(`/revenue-actions?${params.toString()}`);
  return body.actions ?? [];
}

export const getAction = (actionId: string) => call<RevenueAction>(`/revenue-actions/${actionId}`);

export const getAudit = (actionId: string) =>
  call<ActionAudit>(`/revenue-actions/${actionId}/audit`);

// getSourceBody fetches the original email body behind an action (RFC 031
// Layer 3), served from a sealed short-TTL cache or fetched on demand.
export const getSourceBody = (actionId: string) =>
  call<{ body: string }>(`/revenue-actions/${actionId}/source-body`).then((r) => r.body);

export interface CreateActionInput {
  relationshipId: string;
  actionType: string;
  channel: string;
  reason: string;
  recipientEmail?: string;
  proposedSubject?: string;
  proposedMessage?: string;
  executionMode?: "draft" | "send";
  priorityScore?: number;
}

export const createAction = (input: CreateActionInput) =>
  post("/revenue-actions", input) as Promise<RevenueAction>;

// --- relationships -----------------------------------------------------------

export interface RelationshipFilters {
  q?: string;
  lifecycle?: string;
  health?: string;
  engagement?: string;
}

export async function listRelationships(
  filters: RelationshipFilters = {},
): Promise<RevenueRelationship[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.size ? `?${params.toString()}` : "";
  const body = await call<{ relationships: RevenueRelationship[] }>(`/relationships${query}`);
  return body.relationships ?? [];
}

export interface RelationshipGraphRequest {
  scope: "portfolio" | "relationship";
  relationshipId?: string;
  depth?: 1 | 2 | 3;
  asOf?: string;
}

export async function getRelationshipGraph(
  input: RelationshipGraphRequest,
): Promise<RelationshipGraph> {
  const params = new URLSearchParams({ scope: input.scope });
  if (input.relationshipId) params.set("relationshipId", input.relationshipId);
  if (input.depth) params.set("depth", String(input.depth));
  if (input.asOf) params.set("asOf", input.asOf);

  const payload = await call<unknown>(`/relationships/graph?${params.toString()}`);
  const parsed = RelationshipGraphSchema.safeParse(payload);
  if (!parsed.success) {
    throw new RevenueAPIError(
      "The relationship graph response did not match the supported contract.",
      502,
      "invalid_relationship_graph_contract",
    );
  }
  return parsed.data;
}

export const getRelationship = (id: string) => call<RelationshipDetail>(`/relationships/${id}`);

export const acknowledgeMissionControl = (id: string, stateVersion: number, stateHash: string) =>
  post(`/relationships/${id}/acknowledgements`, { stateVersion, stateHash }) as Promise<{
    id: string;
    stateVersion: number;
    stateHash: string;
    acknowledgedAt: string;
  }>;

export const getRelationshipTimeline = (id: string, limit = 50) =>
  call<{ observations: RelationshipObservation[] }>(
    `/relationships/${id}/timeline?limit=${limit}`,
  ).then((body) => body.observations ?? []);

export const getRelationshipChanges = (id: string) =>
  call<{ snapshots: RelationshipStateSnapshot[] }>(`/relationships/${id}/changes`).then(
    (body) => body.snapshots ?? [],
  );

export const getRelationshipEvidence = (relationshipId: string, evidenceId: string) =>
  call<{ observation: RelationshipObservation; payload: unknown }>(
    `/relationships/${relationshipId}/evidence/${evidenceId}`,
  );

export const ingestRelationshipObservations = (observations: RelationshipObservationInput[]) =>
  post("/relationship-observations/batch", { observations }) as Promise<{
    results: Array<{
      observation: RelationshipObservation;
      relationship: RevenueRelationship;
      duplicate: boolean;
    }>;
  }>;

export interface RelationshipCorrectionInput {
  dimension: "lifecycle" | "engagement" | "sentiment" | "health" | "next_action";
  value: string;
  reason: string;
  supersedesAssertionId?: string;
  validTo?: string;
}

export const correctRelationship = (id: string, input: RelationshipCorrectionInput) =>
  post(`/relationships/${id}/corrections`, input) as Promise<RevenueRelationship>;

export const retractRelationshipAssertion = (
  relationshipId: string,
  assertionId: string,
  reason: string,
) =>
  post(`/relationships/${relationshipId}/assertions/${assertionId}/retract`, {
    reason,
  }) as Promise<RevenueRelationship>;

export const correctConversationReview = (
  id: string,
  input: {
    reviewItemId: string;
    correctedValue: string;
    reason: string;
  },
) =>
  post(`/relationships/${id}/conversation-corrections`, input) as Promise<
    Pick<RelationshipDetail, "relationship" | "intelligence">
  >;

export const decideConversationReview = (
  id: string,
  input: {
    reviewItemId: string;
    kind: "approve" | "correct" | "reject" | "defer";
    correctedValue?: string;
    reason?: string;
    deferUntil?: string;
  },
) =>
  post(`/relationships/${id}/conversation-decisions`, input) as Promise<
    Pick<RelationshipDetail, "relationship" | "intelligence">
  >;

export const resolveRelationshipContradiction = (
  id: string,
  caseId: string,
  input: { selectedAssertionId: string; reason?: string },
) =>
  post(
    `/relationships/${encodeURIComponent(id)}/contradictions/${encodeURIComponent(caseId)}/resolve`,
    input,
  ) as Promise<Pick<RelationshipDetail, "relationship" | "intelligence">>;

export const runCommitmentRecovery = (id: string) =>
  post(`/relationships/${encodeURIComponent(id)}/commitment-recovery/run`, {}) as Promise<{
    evaluations: NonNullable<RelationshipDetail["intelligence"]>["recoveryEvaluations"];
  }>;

export const appendCommitmentTransition = (
  relationshipId: string,
  commitmentId: string,
  input: { kind: string; idempotencyKey: string; reason?: string; evidenceRefs?: string[] },
) =>
  post(
    `/relationships/${encodeURIComponent(relationshipId)}/commitments/${encodeURIComponent(commitmentId)}/transitions`,
    input,
  ) as Promise<RelationshipDetail["commitments"][number]>;

export const createMutualActionPlan = (relationshipId: string, commitmentIds: string[]) =>
  post(`/relationships/${encodeURIComponent(relationshipId)}/mutual-action-plans`, {
    commitmentIds,
  }) as Promise<NonNullable<RelationshipDetail["intelligence"]>["mutualActionPlans"][number]>;

export const approveMutualActionPlan = (relationshipId: string, planId: string) =>
  post(
    `/relationships/${encodeURIComponent(relationshipId)}/mutual-action-plans/${encodeURIComponent(planId)}/approve`,
    {},
  ) as Promise<NonNullable<RelationshipDetail["intelligence"]>["mutualActionPlans"][number]>;

export const shareMutualActionPlan = (relationshipId: string, planId: string) =>
  post(
    `/relationships/${encodeURIComponent(relationshipId)}/mutual-action-plans/${encodeURIComponent(planId)}/share`,
    {},
  ) as Promise<{
    plan: NonNullable<RelationshipDetail["intelligence"]>["mutualActionPlans"][number];
    responseToken: string;
  }>;

export const requestConversationDeletion = (relationshipId: string, requestId: string) =>
  post(`/relationships/${encodeURIComponent(relationshipId)}/conversation-deletion`, {
    requestId,
  }) as Promise<NonNullable<RelationshipDetail["intelligence"]>["deletionReceipts"][number]>;

export const listRelationshipSourceStatuses = () =>
  call<{ sources: RelationshipSourceStatus[] }>("/relationship-sources/status").then(
    (body) => body.sources ?? [],
  );

export const listRelationshipSources = () =>
  call<{ sources: RelationshipSourceInventoryItem[] }>("/relationship-sources").then(
    (body) => body.sources ?? [],
  );

export const getRelationshipBetaDiagnostics = () =>
  call<BetaDiagnostics>("/relationship-beta/diagnostics");

export const reportRelationshipSourceAuthorization = (
  source: string,
  input: {
    sourceAccountId?: string;
    state: "started" | "completed" | "canceled" | "failed";
    grantedScopes?: string[];
    errorCode?: string;
  },
) =>
  post(
    `/relationship-sources/${encodeURIComponent(source)}/authorization`,
    input,
  ) as Promise<RelationshipSourceStatus>;

export const resyncRelationshipSource = (source: string, sourceAccountId: string) =>
  post(`/relationship-sources/${encodeURIComponent(source)}/resync`, {
    sourceAccountId,
  }) as Promise<RelationshipSourceStatus>;

export const disconnectRelationshipSource = (source: string, sourceAccountId: string) =>
  post(
    `/relationship-sources/${encodeURIComponent(source)}/${encodeURIComponent(sourceAccountId)}/disconnect`,
    {},
  ) as Promise<RelationshipSourceStatus>;

export const listIdentityCandidates = (status = "pending", relationshipId?: string) => {
  const params = new URLSearchParams({ status });
  if (relationshipId) params.set("relationshipId", relationshipId);
  return call<{ candidates: RelationshipIdentityCandidate[] }>(
    `/relationship-identity-candidates?${params.toString()}`,
  ).then((body) => body.candidates ?? []);
};

export const decideIdentityCandidate = (
  candidateId: string,
  input: { decision: string; reason: string; expectedVersion: number; idempotencyKey: string },
) =>
  post(
    `/relationship-identity-candidates/${encodeURIComponent(candidateId)}/decisions`,
    input,
  ) as Promise<RelationshipIdentityCandidate>;

export const listRelationshipAttention = (status = "open") =>
  call<{ contractVersion: string; asOf: string; items: RelationshipAttentionItem[] }>(
    `/relationship-attention?status=${encodeURIComponent(status)}`,
  ).then((body) => body.items ?? []);

export const decideRelationshipAttention = (
  attentionId: string,
  input: {
    decision: "acknowledge" | "snooze" | "dismiss";
    reason: string;
    expectedVersion: number;
    snoozedUntil?: string;
  },
) =>
  post(
    `/relationship-attention/${encodeURIComponent(attentionId)}/decisions`,
    input,
  ) as Promise<RelationshipAttentionItem>;

export const approveRecommendation = (actionId: string, acceptRisk = false) =>
  post(`/relationship-recommendations/${actionId}/approve`, {
    acceptRisk,
  }) as Promise<RevenueAction>;

export const rejectRecommendation = (actionId: string, reason: string) =>
  post(`/relationship-recommendations/${actionId}/reject`, {
    reason,
  }) as Promise<RevenueAction>;

export interface CreateRelationshipInput {
  kind: string;
  displayName: string;
  primaryEmail?: string;
  accountDomain?: string;
  summary?: string;
}

export const createRelationship = (input: CreateRelationshipInput) =>
  post("/relationships", input) as Promise<RevenueRelationship>;

// --- lifecycle ---------------------------------------------------------------

export interface EditActionInput {
  reason?: string;
  recipientEmail?: string;
  proposedSubject?: string;
  proposedMessage?: string;
  senderAccountRef?: string;
  channel?: string;
  actionType?: string;
  executionMode?: string;
}

export const editAction = (actionId: string, input: EditActionInput) =>
  post(`/revenue-actions/${actionId}/edit`, input) as Promise<RevenueAction>;

export const evaluateAction = (actionId: string) =>
  post(`/revenue-actions/${actionId}/evaluate`) as Promise<RevenuePolicyDecision>;

export const approveAction = (actionId: string, acceptRisk = false) =>
  post(`/revenue-actions/${actionId}/approve`, { acceptRisk }) as Promise<RevenueAction>;

export const rejectAction = (actionId: string, reason: string) =>
  post(`/revenue-actions/${actionId}/reject`, { reason }) as Promise<RevenueAction>;

export const executeAction = (actionId: string) =>
  post(`/revenue-actions/${actionId}/execute`) as Promise<RevenueAction>;

export const snoozeAction = (actionId: string, until: string) =>
  post(`/revenue-actions/${actionId}/snooze`, { until }) as Promise<RevenueAction>;

export const dismissAction = (actionId: string, reason: string) =>
  post(`/revenue-actions/${actionId}/dismiss`, { reason }) as Promise<RevenueAction>;

export interface RecordOutcomeInput {
  kind: string;
  source: string;
  sourceEventId: string;
  occurredAt?: string;
}

export const recordOutcome = (actionId: string, input: RecordOutcomeInput) =>
  post(`/revenue-actions/${actionId}/outcomes`, input) as Promise<RevenueOutcome>;

// --- display helpers ---------------------------------------------------------

export const DETECTOR_LABELS: Record<string, string> = {
  requested_follow_up_due: "Follow-up due",
  unanswered_proposal: "Unanswered proposal",
  waiting_on_me: "Waiting on you",
  dormant_warm_opportunity: "Dormant opportunity",
  neglected_referral: "Neglected referral",
  former_customer_reconnect: "Former customer",
  conversation_action_pack: "Conversation action pack",
  commitment_due: "Commitment due",
  manual: "Manual",
};

export const ACTION_TYPE_LABELS: Record<string, string> = {
  warm_follow_up: "Warm follow-up",
  proposal_nudge: "Proposal nudge",
  referral_reconnect: "Referral reconnect",
  customer_risk: "Customer risk",
  meeting_follow_up: "Meeting follow-up",
  meeting_recap: "Meeting recap",
  crm_update: "CRM update",
  follow_up_task: "Follow-up task",
  calendar_hold: "Calendar hold",
  commitment_rescue: "Commitment rescue",
};

export const RELATIONSHIP_KIND_LABELS: Record<string, string> = {
  person: "Person",
  company: "Company",
  customer: "Customer",
  opportunity: "Opportunity",
  referral: "Referral",
  partner: "Partner",
};

export const OUTCOME_LABELS: Record<string, string> = {
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  replied: "Replied",
  meeting_booked: "Meeting booked",
  won: "Won",
  lost: "Lost",
  dismissed: "Dismissed",
  bad_recommendation: "Bad recommendation",
};

// Outcomes an operator can log by hand from the audit view.
export const MANUAL_OUTCOMES: { value: string; label: string }[] = [
  { value: "replied", label: "They replied" },
  { value: "meeting_booked", label: "Meeting booked" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "bad_recommendation", label: "Bad recommendation" },
];

export const QUEUE_FILTERS: { value: string; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "snoozed", label: "Snoozed" },
  { value: "handled", label: "Handled" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

export const PRIORITY_COMPONENT_LABELS: Record<string, string> = {
  relationship_value: "Relationship value",
  commitment_urgency: "Commitment urgency",
  recency_signal: "Recency",
  opportunity_signal: "Opportunity",
  evidence_quality: "Evidence quality",
  uncertainty_penalty: "Uncertainty",
  contact_risk_penalty: "Contact risk",
};

export function relativeTime(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const day = 86_400_000;
  const past = diff >= 0;
  const fmt = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? "" : "s"} ${past ? "ago" : "from now"}`;
  if (abs < 3600_000) return fmt(Math.max(1, Math.round(abs / 60_000)), "min");
  if (abs < day) return fmt(Math.round(abs / 3600_000), "hour");
  if (abs < 30 * day) return fmt(Math.round(abs / day), "day");
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
