import { getAccessToken } from "../auth/tokens.js";
import { API_URL } from "../config/env.js";
import type {
  Relationship,
  RelationshipAction,
  RelationshipActionAudit,
  RelationshipOutcome,
  RelationshipDetail,
  RelationshipObservation,
  RelationshipObservationIngestResult,
  RelationshipObservationInput,
  RelationshipSemanticMatch,
  RelationshipSourceStatus,
  RelationshipSourceInventoryItem,
  RelationshipIdentityCandidate,
  RelationshipAttentionItem,
  RelationshipStateSnapshot,
  CommitmentRecoveryEvaluation,
  RelationshipCommitment,
  MutualActionPlan,
  MutualActionPlanItem,
  ConversationDeletionReceipt,
  BetaDiagnostics,
  RelationshipGraph,
} from "@x/shared/dist/relationships.js";

/**
 * A non-2xx response from the relationship API, carrying the status.
 *
 * The status is the difference between "the network is down, try again" and "this
 * payload will never be accepted". Without it, a permanently rejected observation
 * is retried forever and blocks everything queued behind it.
 */
export class RelationshipApiError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(detail);
    this.name = "RelationshipApiError";
  }

  /** Retrying will not change the answer. */
  get permanent(): boolean {
    return (
      this.status === 400 ||
      this.status === 403 ||
      this.status === 409 ||
      this.status === 422
    );
  }
}

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
    // Message text is unchanged from the previous bare Error so existing log
    // output and any string matching on it keep working.
    throw new RelationshipApiError(response.status, detail);
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

export function getRelationshipGraph(input: {
  scope: "portfolio" | "relationship";
  relationshipId?: string;
  depth?: number;
  asOf?: string;
}): Promise<RelationshipGraph> {
  const params = new URLSearchParams({ scope: input.scope });
  if (input.relationshipId) params.set("relationshipId", input.relationshipId);
  if (input.depth) params.set("depth", String(input.depth));
  if (input.asOf) params.set("asOf", input.asOf);
  return call(`/v1/relationships/graph?${params.toString()}`);
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

export const acknowledgeMissionControl = (id: string, stateVersion: number, stateHash: string) =>
  call<{ id: string; stateVersion: number; stateHash: string; acknowledgedAt: string }>(
    `/v1/relationships/${encodeURIComponent(id)}/acknowledgements`,
    { method: "POST", body: JSON.stringify({ stateVersion, stateHash }) },
  );

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

export const getRelationshipSourceInventory = () =>
  call<{ sources: RelationshipSourceInventoryItem[] }>("/v1/relationship-sources");

export const getRelationshipBetaDiagnostics = () =>
  call<BetaDiagnostics>("/v1/relationship-beta/diagnostics");

export const reportRelationshipSourceAuthorization = (
  source: string,
  input: {
    sourceAccountId?: string;
    state: "started" | "completed" | "canceled" | "failed";
    grantedScopes?: string[];
    errorCode?: string;
  },
) =>
  call<RelationshipSourceStatus>(
    `/v1/relationship-sources/${encodeURIComponent(source)}/authorization`,
    { method: "POST", body: JSON.stringify(input) },
  );

export const resyncRelationshipSource = (source: string, sourceAccountId: string) =>
  call<RelationshipSourceStatus>(`/v1/relationship-sources/${encodeURIComponent(source)}/resync`, {
    method: "POST",
    body: JSON.stringify({ sourceAccountId }),
  });

export const disconnectRelationshipSource = (source: string, sourceAccountId: string) =>
  call<RelationshipSourceStatus>(
    `/v1/relationship-sources/${encodeURIComponent(source)}/${encodeURIComponent(sourceAccountId)}/disconnect`,
    { method: "POST", body: "{}" },
  );

export const listIdentityCandidates = (status = "pending", relationshipId?: string) => {
  const params = new URLSearchParams({ status });
  if (relationshipId) params.set("relationshipId", relationshipId);
  return call<{ candidates: RelationshipIdentityCandidate[] }>(
    `/v1/relationship-identity-candidates?${params.toString()}`,
  );
};

export const decideIdentityCandidate = (
  candidateId: string,
  input: { decision: string; reason: string; expectedVersion: number; idempotencyKey: string },
) =>
  call<RelationshipIdentityCandidate>(
    `/v1/relationship-identity-candidates/${encodeURIComponent(candidateId)}/decisions`,
    { method: "POST", body: JSON.stringify(input) },
  );

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

/**
 * Delete a person and suppress their identity so ingest cannot recreate them.
 *
 * `reason` separates a subject asking to be forgotten from the account holder
 * tidying their graph. Only the first is a promise made to someone who is not
 * the user, and a system that cannot tell them apart cannot honour that
 * difference later.
 *
 * Returns a receipt rather than nothing: deleting another person's data should
 * be evidenced, not merely acknowledged.
 */
export const deletePerson = (
  personId: string,
  input?: { reason?: "user_action" | "subject_request"; note?: string },
) =>
  call<PersonDeletionReceipt>(`/v1/relationship-persons/${encodeURIComponent(personId)}`, {
    method: "DELETE",
    body: JSON.stringify(input ?? {}),
  });

export const listRelationshipAttention = (status = "open") =>
  call<{ contractVersion: string; asOf: string; items: RelationshipAttentionItem[] }>(
    `/v1/relationship-attention?status=${encodeURIComponent(status)}`,
  );

export const decideRelationshipAttention = (
  attentionId: string,
  input: {
    decision: "acknowledge" | "snooze" | "dismiss";
    reason: string;
    expectedVersion: number;
    snoozedUntil?: string;
  },
) =>
  call<RelationshipAttentionItem>(
    `/v1/relationship-attention/${encodeURIComponent(attentionId)}/decisions`,
    { method: "POST", body: JSON.stringify(input) },
  );

export const editRelationshipAction = (
  actionId: string,
  input: { proposedSubject?: string; proposedMessage?: string; reason?: string },
) =>
  call<RelationshipAction>(`/v1/revenue-actions/${encodeURIComponent(actionId)}/edit`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const createRelationshipAction = (input: {
  relationshipId: string;
  actionType: string;
  channel: string;
  reason: string;
  recipientEmail?: string;
  proposedSubject?: string;
  proposedMessage?: string;
  executionMode?: "draft" | "send";
  priorityScore?: number;
}) =>
  call<RelationshipAction>("/v1/revenue-actions", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const evaluateRelationshipAction = (actionId: string) =>
  call<unknown>(`/v1/revenue-actions/${encodeURIComponent(actionId)}/evaluate`, {
    method: "POST",
    body: "{}",
  });

export const executeRelationshipAction = (actionId: string) =>
  call<RelationshipAction>(`/v1/revenue-actions/${encodeURIComponent(actionId)}/execute`, {
    method: "POST",
    body: "{}",
  });

export const snoozeRelationshipAction = (actionId: string, until: string) =>
  call<RelationshipAction>(`/v1/revenue-actions/${encodeURIComponent(actionId)}/snooze`, {
    method: "POST",
    body: JSON.stringify({ until }),
  });

export const dismissRelationshipAction = (actionId: string, reason: string) =>
  call<RelationshipAction>(`/v1/revenue-actions/${encodeURIComponent(actionId)}/dismiss`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });

export const getRelationshipActionAudit = (actionId: string) =>
  call<RelationshipActionAudit>(`/v1/revenue-actions/${encodeURIComponent(actionId)}/audit`);

export const getRelationshipActionSourceBody = (actionId: string) =>
  call<{ body: string }>(`/v1/revenue-actions/${encodeURIComponent(actionId)}/source-body`).then(
    (result) => result.body,
  );

export const recordRelationshipActionOutcome = (
  actionId: string,
  input: {
    kind: string;
    source: "user";
    sourceEventId: string;
    occurredAt?: string;
    metadata?: Record<string, unknown>;
  },
) =>
  call<RelationshipOutcome>(`/v1/revenue-actions/${encodeURIComponent(actionId)}/outcomes`, {
    method: "POST",
    body: JSON.stringify(input),
  });

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
  input: {
    dimension: string;
    value: string;
    reason: string;
    supersedesAssertionId?: string;
    validTo?: string;
  },
) =>
  call<Relationship>(`/v1/relationships/${encodeURIComponent(id)}/corrections`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const retractRelationshipAssertion = (
  relationshipId: string,
  assertionId: string,
  reason: string,
) =>
  call<Relationship>(
    `/v1/relationships/${encodeURIComponent(relationshipId)}/assertions/${encodeURIComponent(assertionId)}/retract`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );

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

// --- cloud research (RFC 039) ------------------------------------------------

/** Whether this workspace has agreed to send counterparty details to the vendor. */
export type ResearchConsentState = {
  consented: boolean;
  consentedAt?: string;
};

/**
 * What the desktop needs to render the research control honestly.
 *
 * `allowed` is the server's answer, not ours. The desktop must never decide it
 * can do research: the vendor key, the capability, the plan and the consent all
 * live server-side, and a client that guessed would show a control that fails
 * when used.
 */
export type ResearchStatus = {
  available: boolean;
  allowed: boolean;
  reason?: string;
  requiredPlan: string;
  consent: ResearchConsentState;
};

export type PersonResearchOutcome = {
  personId: string;
  matched: boolean;
  runId?: string;
  written: number;
  rejected?: string[];
  replayed: boolean;
};

export type ResearchEstimate = {
  people: number;
  processor: string;
  credits: number;
  usd: number;
  batchSize: number;
};

export const getResearchStatus = () => call<ResearchStatus>("/v1/research/status");

export const setResearchConsent = (consented: boolean) =>
  call<ResearchConsentState>("/v1/research/consent", {
    method: "PUT",
    body: JSON.stringify({ consented }),
  });

export const getResearchEstimate = () =>
  call<ResearchEstimate>("/v1/research/people/estimate");

export const listPendingResearchPeople = () =>
  call<{ personIds: string[] }>("/v1/research/people/pending");

export const enrichPerson = (personId: string) =>
  call<PersonResearchOutcome>(`/v1/research/people/${personId}`, { method: "POST" });

/**
 * Enrich one chunk of a bulk run.
 *
 * The caller walks the pending list in batches of `estimate.batchSize`. Chunking
 * is the client's job because the desktop sleeps: a re-sent chunk costs nothing
 * for the people it already covered, so resuming is just sending the same list
 * again.
 */
export const enrichPeople = (personIds: string[]) =>
  call<{ outcomes: PersonResearchOutcome[] }>("/v1/research/people", {
    method: "POST",
    body: JSON.stringify({ personIds }),
  });

/**
 * Run the whole pending enrichment, in server-sized chunks.
 *
 * Chunking lives here rather than in the renderer because the batch size is a
 * server contract. A chunk that fails stops the run and reports how far it got:
 * enrichment is idempotent per person and task-spec version, so "run it again"
 * resumes rather than re-charging.
 */
export async function enrichPendingPeople(): Promise<{
  requested: number;
  enriched: number;
  matched: number;
  attributes: number;
  stoppedReason?: string;
}> {
  const estimate = await getResearchEstimate();
  const { personIds } = await listPendingResearchPeople();
  const summary = {
    requested: personIds.length,
    enriched: 0,
    matched: 0,
    attributes: 0,
    stoppedReason: undefined as string | undefined,
  };
  const batchSize = Math.max(1, estimate.batchSize);
  for (let i = 0; i < personIds.length; i += batchSize) {
    try {
      const { outcomes } = await enrichPeople(personIds.slice(i, i + batchSize));
      for (const outcome of outcomes) {
        summary.enriched += 1;
        if (outcome.matched) summary.matched += 1;
        summary.attributes += outcome.written;
      }
    } catch (error) {
      summary.stoppedReason =
        error instanceof RelationshipApiError ? error.message : "the run could not be completed";
      return summary;
    }
  }
  return summary;
}
