import { getAccessToken } from "../auth/tokens.js";
import { API_URL } from "../config/env.js";
import type {
  Relationship,
  RelationshipAction,
  RelationshipDetail,
  RelationshipObservation,
  RelationshipObservationIngestResult,
  RelationshipObservationInput,
  RelationshipSemanticMatch,
  RelationshipSourceStatus,
  RelationshipStateSnapshot,
  CommitmentRecoveryEvaluation,
  RelationshipCommitment,
  MutualActionPlan,
  MutualActionPlanItem,
  ConversationDeletionReceipt,
} from "@x/shared/dist/relationships.js";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const accessToken = await getAccessToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let detail = `Relationship API failed (${response.status})`;
    try {
      const body = (await response.json()) as { detail?: string; title?: string };
      detail = body.detail || body.title || detail;
    } catch {
      // Preserve the status-based message for non-JSON errors.
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export async function listRelationships(filters: {
  q?: string;
  lifecycle?: string;
  health?: string;
  engagement?: string;
}): Promise<{ relationships: Relationship[] }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.size ? `?${params.toString()}` : "";
  return call(`/v1/relationships${query}`);
}

export const createRelationship = (input: {
  kind: string;
  displayName: string;
  primaryEmail?: string;
  accountDomain?: string;
  summary?: string;
}) =>
  call<Relationship>("/v1/relationships", {
    method: "POST",
    body: JSON.stringify(input),
  });

export async function searchRelationships(query: string) {
  const params = new URLSearchParams({ q: query });
  return call<{ available: boolean; matches: RelationshipSemanticMatch[] }>(
    `/v1/revenue-search?${params.toString()}`,
  );
}

export const getRelationship = (id: string) =>
  call<RelationshipDetail>(`/v1/relationships/${encodeURIComponent(id)}`);

export const getRelationshipTimeline = (id: string, limit = 50) =>
  call<{ observations: RelationshipObservation[] }>(
    `/v1/relationships/${encodeURIComponent(id)}/timeline?limit=${limit}`,
  );

export const getRelationshipChanges = (id: string) =>
  call<{ snapshots: RelationshipStateSnapshot[] }>(
    `/v1/relationships/${encodeURIComponent(id)}/changes`,
  );

export const getRelationshipSources = () =>
  call<{ sources: RelationshipSourceStatus[] }>("/v1/relationship-sources/status");

export const getRelationshipEvidence = (relationshipId: string, evidenceId: string) =>
  call<{ observation: RelationshipObservation; payload: unknown }>(
    `/v1/relationships/${encodeURIComponent(relationshipId)}/evidence/${encodeURIComponent(evidenceId)}`,
  );

export const ingestRelationshipObservations = (observations: RelationshipObservationInput[]) =>
  call<{ results: RelationshipObservationIngestResult[] }>("/v1/relationship-observations/batch", {
    method: "POST",
    body: JSON.stringify({ observations }),
  });

export const correctRelationship = (
  id: string,
  input: { dimension: string; value: string; reason: string },
) =>
  call<Relationship>(`/v1/relationships/${encodeURIComponent(id)}/corrections`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const correctConversationReview = (
  id: string,
  input: {
    reviewItemId: string;
    correctedValue: string;
    reason: string;
  },
) =>
  call<Pick<RelationshipDetail, "relationship" | "intelligence">>(
    `/v1/relationships/${encodeURIComponent(id)}/conversation-corrections`,
    { method: "POST", body: JSON.stringify(input) },
  );

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
  call<Pick<RelationshipDetail, "relationship" | "intelligence">>(
    `/v1/relationships/${encodeURIComponent(id)}/conversation-decisions`,
    { method: "POST", body: JSON.stringify(input) },
  );

export const resolveRelationshipContradiction = (
  id: string,
  caseId: string,
  input: { selectedAssertionId: string; reason?: string },
) =>
  call<Pick<RelationshipDetail, "relationship" | "intelligence">>(
    `/v1/relationships/${encodeURIComponent(id)}/contradictions/${encodeURIComponent(caseId)}/resolve`,
    { method: "POST", body: JSON.stringify(input) },
  );

export const runCommitmentRecovery = (id: string) =>
  call<{ evaluations: CommitmentRecoveryEvaluation[] }>(
    `/v1/relationships/${encodeURIComponent(id)}/commitment-recovery/run`,
    { method: "POST", body: JSON.stringify({}) },
  );

export const appendCommitmentTransition = (
  relationshipId: string,
  commitmentId: string,
  input: {
    kind: string;
    idempotencyKey: string;
    reason?: string;
    dueAt?: string;
    action?: string;
    blocker?: string;
    evidenceRefs?: string[];
  },
) =>
  call<RelationshipCommitment>(
    `/v1/relationships/${encodeURIComponent(relationshipId)}/commitments/${encodeURIComponent(commitmentId)}/transitions`,
    { method: "POST", body: JSON.stringify(input) },
  );

export const createMutualActionPlan = (relationshipId: string, commitmentIds: string[]) =>
  call<MutualActionPlan>(
    `/v1/relationships/${encodeURIComponent(relationshipId)}/mutual-action-plans`,
    { method: "POST", body: JSON.stringify({ commitmentIds }) },
  );

export const reviseMutualActionPlan = (
  relationshipId: string,
  planId: string,
  items: MutualActionPlanItem[],
) =>
  call<MutualActionPlan>(
    `/v1/relationships/${encodeURIComponent(relationshipId)}/mutual-action-plans/${encodeURIComponent(planId)}`,
    { method: "PUT", body: JSON.stringify({ items }) },
  );

export const approveMutualActionPlan = (relationshipId: string, planId: string) =>
  call<MutualActionPlan>(
    `/v1/relationships/${encodeURIComponent(relationshipId)}/mutual-action-plans/${encodeURIComponent(planId)}/approve`,
    { method: "POST", body: JSON.stringify({}) },
  );

export const shareMutualActionPlan = (relationshipId: string, planId: string) =>
  call<{ plan: MutualActionPlan; responseToken: string }>(
    `/v1/relationships/${encodeURIComponent(relationshipId)}/mutual-action-plans/${encodeURIComponent(planId)}/share`,
    { method: "POST", body: JSON.stringify({}) },
  );

export const requestConversationDeletion = (relationshipId: string, requestId: string) =>
  call<ConversationDeletionReceipt>(
    `/v1/relationships/${encodeURIComponent(relationshipId)}/conversation-deletion`,
    { method: "POST", body: JSON.stringify({ requestId }) },
  );

export const approveRelationshipRecommendation = (actionId: string, acceptRisk = false) =>
  call<RelationshipAction>(
    `/v1/relationship-recommendations/${encodeURIComponent(actionId)}/approve`,
    { method: "POST", body: JSON.stringify({ acceptRisk }) },
  );

export const rejectRelationshipRecommendation = (actionId: string, reason: string) =>
  call<RelationshipAction>(
    `/v1/relationship-recommendations/${encodeURIComponent(actionId)}/reject`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
