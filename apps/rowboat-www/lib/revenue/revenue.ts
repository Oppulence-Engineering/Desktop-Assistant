// Revenue BFF client (RFC 030). Fetchers stay server-importable so RSC
// prefetch can share the same keys and Zod contracts as the browser hooks.

import { fetchCommitments } from "@/hooks/queries/utils/fetch-commitments";
import { fetchDigest, fetchImpact } from "@/hooks/queries/utils/fetch-impact";
import {
  fetchOpenPromisesReport,
  fetchReportScan,
  fetchReportScans,
} from "@/hooks/queries/utils/fetch-report";
import { fetchRevenueActions } from "@/hooks/queries/utils/fetch-revenue-actions";
import {
  fetchRelationshipSources,
  fetchRelationshipSourceStatuses,
} from "@/hooks/queries/utils/fetch-relationship-sources";
import {
  fetchIdentityCandidates,
  fetchPersons,
  fetchRelationshipAttention,
  fetchRelationshipGraph,
  fetchRelationships,
  fetchSemanticSearch,
} from "@/hooks/queries/utils/fetch-relationships";
import {
  fetchCommunicationPolicy,
  fetchCommunicationPrivacyRules,
} from "@/hooks/queries/utils/fetch-communication";
import { fetchWorkspace } from "@/hooks/queries/utils/fetch-workspace";
import { fetchAcknowledgeMissionControl } from "@/hooks/queries/utils/mutate-acknowledge-mission-control";
import {
  fetchAppendCommitmentTransition,
  type AppendCommitmentTransitionInput,
} from "@/hooks/queries/utils/mutate-append-commitment-transition";
import { fetchApproveMutualActionPlan } from "@/hooks/queries/utils/mutate-approve-mutual-action-plan";
import { fetchApproveRelationshipRecommendation } from "@/hooks/queries/utils/mutate-approve-relationship-recommendation";
import { fetchApproveRevenueAction } from "@/hooks/queries/utils/mutate-approve-revenue-action";
import { fetchCorrectConversationEvidence } from "@/hooks/queries/utils/mutate-correct-conversation-evidence";
import { fetchCorrectRelationship } from "@/hooks/queries/utils/mutate-correct-relationship";
import {
  fetchCreateMutualActionPlan,
  type CreateMutualActionPlanInput,
} from "@/hooks/queries/utils/mutate-create-mutual-action-plan";
import {
  fetchCreateRelationship,
  type CreateRelationshipInput as CreateRelationshipMutationInput,
} from "@/hooks/queries/utils/mutate-create-relationship";
import {
  fetchCreateRevenueAction,
  type CreateRevenueActionInput,
} from "@/hooks/queries/utils/mutate-create-revenue-action";
import { fetchDecideConversationChange } from "@/hooks/queries/utils/mutate-decide-conversation-change";
import { fetchDecideRelationshipAttention } from "@/hooks/queries/utils/mutate-decide-relationship-attention";
import {
  fetchDecideRelationshipIdentityCandidate,
  type DecideRelationshipIdentityCandidateInput,
} from "@/hooks/queries/utils/mutate-decide-relationship-identity-candidate";
import { fetchDisconnectRelationshipSource } from "@/hooks/queries/utils/mutate-disconnect-relationship-source";
import { fetchDismissRevenueAction } from "@/hooks/queries/utils/mutate-dismiss-revenue-action";
import {
  fetchEditRevenueAction,
  type EditRevenueActionInput,
} from "@/hooks/queries/utils/mutate-edit-revenue-action";
import { fetchEvaluateRevenueAction } from "@/hooks/queries/utils/mutate-evaluate-revenue-action";
import { fetchExecuteRevenueAction } from "@/hooks/queries/utils/mutate-execute-revenue-action";
import {
  fetchIngestRelationshipObservations,
  type IngestRelationshipObservationsInput,
} from "@/hooks/queries/utils/mutate-ingest-relationship-observations";
import {
  fetchLinkRevenueWorkspace,
  type LinkRevenueWorkspaceInput,
} from "@/hooks/queries/utils/mutate-link-revenue-workspace";
import {
  fetchRecordRevenueActionOutcome,
  type RecordRevenueActionOutcomeInput,
} from "@/hooks/queries/utils/mutate-record-revenue-action-outcome";
import { fetchRejectRelationshipRecommendation } from "@/hooks/queries/utils/mutate-reject-relationship-recommendation";
import { fetchRejectRevenueAction } from "@/hooks/queries/utils/mutate-reject-revenue-action";
import { fetchReportRelationshipSourceAuthorization } from "@/hooks/queries/utils/mutate-report-relationship-source-authorization";
import { fetchRequestConversationDeletion } from "@/hooks/queries/utils/mutate-request-conversation-deletion";
import { fetchResolveRelationshipContradiction } from "@/hooks/queries/utils/mutate-resolve-relationship-contradiction";
import { fetchResyncRelationshipSource } from "@/hooks/queries/utils/mutate-resync-relationship-source";
import { fetchRetractRelationshipAssertion } from "@/hooks/queries/utils/mutate-retract-relationship-assertion";
import { fetchRunCommitmentRecovery } from "@/hooks/queries/utils/mutate-run-commitment-recovery";
import { fetchShareMutualActionPlan } from "@/hooks/queries/utils/mutate-share-mutual-action-plan";
import { fetchSnoozeRevenueAction } from "@/hooks/queries/utils/mutate-snooze-revenue-action";
import { fetchStartRevenueLeakScan } from "@/hooks/queries/utils/mutate-start-revenue-leak-scan";
import type { RelationshipListScope } from "@/hooks/queries/utils/relationship-keys";
import { RELATIONSHIP_SOURCE_STATUS_QUERY_KEY } from "@/hooks/queries/utils/relationship-source-keys";
import { DashboardRequestError } from "@/lib/api/request-json";
import {
  dashboardRequest,
  redirectBrowserIfUnauthorized,
  toDashboardAPIPath,
} from "@/lib/auth/dashboard-fetch";
import { ExportCommitment200Response } from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import type {
  ActionAudit,
  RelationshipDetail,
  RevenueAction,
  RevenueLeakScan,
  RevenueRelationship,
  RelationshipObservation,
  RelationshipSourceStatus,
  BetaDiagnostics,
  RelationshipGraph,
  RelationshipStateSnapshot,
  PersonDeletionReceipt,
  CompanyResearchOutcome,
  PersonResearchOutcome,
  RelationshipPerson,
  RelationshipPersonAttribute,
  ResearchConsentState,
  ResearchEstimate,
  ResearchStatus,
  CommunicationPolicy,
  CommunicationPrivacyRule,
  CommunicationTimelineItem,
  CommitmentRegisterFilter,
  CommitmentRecord,
  RegisterEntry,
} from "@/lib/revenue/types";

// Initial evidence reads use a bounded six-month window. Later scans advance
// from the latest freshness cursor and therefore remain incremental.
export const REVENUE_EVIDENCE_LOOKBACK_DAYS = 180;
export const REVENUE_EVIDENCE_LOOKBACK_LABEL = "6 months";

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

function asRevenueError(error: unknown): never {
  if (error instanceof DashboardRequestError) {
    throw new RevenueAPIError(error.message, error.status, error.code);
  }
  throw error;
}

async function viaRequest<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    asRevenueError(error);
  }
}

/**
 * Validates a response against its contract.
 *
 * A mismatch means this client and the API disagree about the shape, which is
 * a deployment fact, not something the reader did. A zod issue list is a
 * developer artifact — printed verbatim it put
 * `[{"expected":"array","code":"invalid_type",…}]` in front of the user — so
 * the issues go to the console and the caller gets a sentence it can render.
 */
function parsed<T>(schema: { parse: (value: unknown) => T }, value: unknown, subject: string): T {
  try {
    return schema.parse(value);
  } catch (error) {
    console.error(`Unexpected ${subject} response`, error);
    throw new RevenueAPIError(
      `The ${subject} response did not match what this app expects. The app and the API are probably running different versions.`,
      0,
      "schema_mismatch",
    );
  }
}

export function friendlyRevenueError(message: string) {
  if (/gmail.*(?:returned 429|user-rate limit exceeded)/i.test(message)) {
    return "Google is temporarily limiting Gmail reads for this account. Please try the audit again in about 15 minutes.";
  }
  if (/session refresh is temporarily unavailable|session_unavailable/i.test(message)) {
    return "Your session could not be refreshed. Sign out and sign in again.";
  }
  if (/rowboat-api is unreachable|upstream_unavailable/i.test(message)) {
    return "The Oppulence API is not reachable. In local dev, start rowboat-api on port 18080, then reload.";
  }
  if (/^Request failed \(503\)$/.test(message)) {
    return "The Oppulence API returned an error (503). Confirm rowboat-api is running on port 18080, then reload.";
  }
  return message;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await dashboardRequest(toDashboardAPIPath(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers || {}),
    },
  });
  redirectBrowserIfUnauthorized(res.status);
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

export function safeResearchCitationURL(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// --- workspace ---------------------------------------------------------------

export const getWorkspace = (signal?: AbortSignal) => viaRequest(() => fetchWorkspace(signal));

export const getImpact = (signal?: AbortSignal) => viaRequest(() => fetchImpact(signal));

export const getDigest = (signal?: AbortSignal) => viaRequest(() => fetchDigest(signal));

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
  signal?: AbortSignal,
): Promise<{ available: boolean; matches: SemanticMatch[] }> {
  return viaRequest(() => fetchSemanticSearch(query, signal));
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

export type LinkWorkspaceInput = LinkRevenueWorkspaceInput;

export const linkWorkspace = (input: LinkWorkspaceInput) =>
  viaRequest(() => fetchLinkRevenueWorkspace(input));

// --- scan --------------------------------------------------------------------

export const startScan = (lookbackDays?: number) =>
  viaRequest(() => fetchStartRevenueLeakScan(lookbackDays ? { lookbackDays } : {}));

export const getScan = fetchReportScan;

export const listScans = fetchReportScans;

export function latestCompletedScan(
  scans: Array<Pick<RevenueLeakScan, "id" | "status" | "threadsSeen">>,
) {
  return (
    scans.find((scan) => scan.status === "completed" && (scan.threadsSeen ?? 0) > 0) ??
    scans.find((scan) => scan.status === "completed")
  );
}

export type RelationshipSourceHealth = "not_connected" | "needs_reconnect" | "ready";

type SourceHealthRecord = {
  source: string;
  status: string;
  missingScopes?: string[];
};

const STOPPED_SOURCE_STATUSES = new Set(["reconnect_required", "disconnected", "not_connected"]);

/**
 * Resolves source readiness account-by-account. A stale failed account must
 * not block an audit after another account has reconnected successfully.
 */
export function relationshipSourceHealth(
  sources: SourceHealthRecord[],
  sourceName = "google",
): RelationshipSourceHealth {
  const matching = sources.filter((source) => source.source === sourceName);
  if (matching.length === 0) return "not_connected";

  const hasUsableAccount = matching.some(
    (source) =>
      !STOPPED_SOURCE_STATUSES.has(source.status) && (source.missingScopes?.length ?? 0) === 0,
  );
  if (hasUsableAccount) return "ready";

  return matching.every(
    (source) =>
      STOPPED_SOURCE_STATUSES.has(source.status) || (source.missingScopes?.length ?? 0) > 0,
  )
    ? "needs_reconnect"
    : "not_connected";
}

export function googleSourceHealth(
  sources: Array<{
    source: string;
    accounts: Array<{ status: string; missingScopes: string[] }>;
  }>,
) {
  return relationshipSourceHealth(
    sources.flatMap((source) =>
      source.accounts.map((account) => ({ source: source.source, ...account })),
    ),
  );
}

export const googleNeedsReconnect = (sources: RelationshipSourceStatus[]) =>
  relationshipSourceHealth(sources) === "needs_reconnect";

/** Sources still delivering evidence; stopped grants do not count. */
export const connectedSourceCount = (sources: RelationshipSourceStatus[]) =>
  sources.filter(
    (source) =>
      !STOPPED_SOURCE_STATUSES.has(source.status) && (source.missingScopes?.length ?? 0) === 0,
  ).length;

// --- queue reads -------------------------------------------------------------

export async function listActions(
  queueStatus = "open",
  limit = 25,
  signal?: AbortSignal,
): Promise<RevenueAction[]> {
  return viaRequest(() => fetchRevenueActions(queueStatus, limit, signal));
}

export const getAction = (actionId: string) => call<RevenueAction>(`/revenue-actions/${actionId}`);

export const getAudit = (actionId: string) =>
  call<ActionAudit>(`/revenue-actions/${actionId}/audit`);

// getSourceBody fetches the original email body behind an action (RFC 031
// Layer 3), served from a sealed short-TTL cache or fetched on demand.
export const getSourceBody = (actionId: string) =>
  call<{ body: string }>(`/revenue-actions/${actionId}/source-body`).then((r) => r.body);

export type CreateActionInput = CreateRevenueActionInput;

export const createAction = (input: CreateActionInput) =>
  viaRequest(() => fetchCreateRevenueAction(input));

// --- relationships -----------------------------------------------------------

export interface RelationshipFilters {
  q?: string;
  lifecycle?: string;
  health?: string;
  engagement?: string;
}

export const companyLinkedInURL = (
  displayName: string,
  resourceRefs: string[],
  linkedinURL?: string,
) => {
  if (linkedinURL?.startsWith("https://www.linkedin.com/company/")) return linkedinURL;
  const prefix = "linkedin:company:";
  const linkedInRef = resourceRefs.find((ref) => ref.startsWith(prefix));
  return linkedInRef
    ? `https://www.linkedin.com/company/${encodeURIComponent(linkedInRef.slice(prefix.length))}`
    : `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(displayName)}`;
};

// An absent count is not a count of zero.
//
// This rendered `count ?? 0` as "0 interactions", so an account last touched
// eighteen hours ago was labelled as having no interactions at all — the
// number had simply never been computed. Stating a total nobody counted is the
// product's worst failure mode: confidently wrong beats "we do not know".
export const interactionCountLabel = (count: number | null | undefined) => {
  if (count === null || count === undefined) return "—";
  // It counts indexed email threads, so it says so. Called "interactions" it
  // read as every touch of the account, which made "0 interactions" sit next
  // to "last interaction 18 hours ago" and look like a contradiction — the
  // account had been touched, just not over indexed mail.
  return `${count} email thread${count === 1 ? "" : "s"}`;
};

export async function listRelationships(
  filters: RelationshipFilters = {},
  signal?: AbortSignal,
): Promise<RevenueRelationship[]> {
  return viaRequest(() => fetchRelationships(filters as RelationshipListScope, signal));
}

export interface RelationshipGraphRequest {
  scope: "portfolio" | "relationship";
  relationshipId?: string;
  depth?: 1 | 2 | 3;
  asOf?: string;
}

export async function getRelationshipGraph(
  input: RelationshipGraphRequest,
  signal?: AbortSignal,
): Promise<RelationshipGraph> {
  return viaRequest(() => fetchRelationshipGraph(input, signal));
}

export const getRelationship = (id: string) => call<RelationshipDetail>(`/relationships/${id}`);

export async function listPersons(q = "", signal?: AbortSignal): Promise<RelationshipPerson[]> {
  return viaRequest(() => fetchPersons(q, signal));
}

export const getPersonAttributes = (personId: string) =>
  call<{ attributes: RelationshipPersonAttribute[] }>(
    `/relationship-persons/${encodeURIComponent(personId)}/attributes`,
  ).then((body) => body.attributes ?? []);

export const getResearchStatus = () => call<ResearchStatus>("/research/status");

// These writes have no OpenAPI operationId with a 200/201/202 schema, so
// `gen mutation --operation` cannot express them. Do not invent a local Zod
// stub; document the route on the Go spec, then generate.
export const setResearchConsent = (consented: boolean) =>
  call<ResearchConsentState>("/research/consent", {
    method: "PUT",
    body: JSON.stringify({ consented }),
  });

export const getResearchEstimate = () => call<ResearchEstimate>("/research/people/estimate");

export const getCompanyResearchEstimate = () =>
  call<ResearchEstimate>("/research/companies/estimate");

const researchSignal = () => AbortSignal.timeout(10 * 60_000);

export const enrichPendingPersons = async (batchSize: number) => {
  const { personIds } = await call<{ personIds: string[] }>("/research/people/pending");
  const outcomes: PersonResearchOutcome[] = [];
  const size = Math.max(1, Math.floor(batchSize));
  for (let offset = 0; offset < personIds.length; offset += size) {
    const result = await call<{ outcomes: PersonResearchOutcome[] }>("/research/people", {
      method: "POST",
      body: JSON.stringify({ personIds: personIds.slice(offset, offset + size) }),
      signal: researchSignal(),
    });
    outcomes.push(...(result.outcomes ?? []));
  }
  return { requested: personIds.length, outcomes };
};

export const enrichPendingCompanies = async (batchSize: number) => {
  const { relationshipIds } = await call<{ relationshipIds: string[] }>(
    "/research/companies/pending",
  );
  const outcomes: CompanyResearchOutcome[] = [];
  const size = Math.max(1, Math.floor(batchSize));
  for (let offset = 0; offset < relationshipIds.length; offset += size) {
    const result = await call<{ outcomes: CompanyResearchOutcome[] }>("/research/companies", {
      method: "POST",
      body: JSON.stringify({ relationshipIds: relationshipIds.slice(offset, offset + size) }),
      signal: researchSignal(),
    });
    outcomes.push(...(result.outcomes ?? []));
  }
  return { requested: relationshipIds.length, outcomes };
};

export const deletePerson = (personId: string) =>
  call<PersonDeletionReceipt>(`/relationship-persons/${encodeURIComponent(personId)}`, {
    method: "DELETE",
    body: JSON.stringify({ reason: "user_action" }),
  });

export const acknowledgeMissionControl = (id: string, stateVersion: number, stateHash: string) =>
  viaRequest(() => fetchAcknowledgeMissionControl(id, { stateVersion, stateHash }));

export const getRelationshipTimeline = (id: string, limit = 50, signal?: AbortSignal) =>
  call<{ observations: RelationshipObservation[] }>(
    `/relationships/${id}/timeline?limit=${limit}`,
    { signal },
  ).then((body) => body.observations ?? []);

export const getRelationshipCommunicationTimeline = (
  id: string,
  limit = 50,
  before?: string,
  signal?: AbortSignal,
) =>
  call<{ items: CommunicationTimelineItem[]; hasMore: boolean; nextBefore?: string }>(
    `/relationships/${id}/communication-timeline?limit=${limit}${
      before ? `&before=${encodeURIComponent(before)}` : ""
    }`,
    { signal },
  )
    .then((body) => body.items ?? [])
    .catch((error) => {
      // Workspaces without communication intelligence, or an older API,
      // answer 404/409. The company sheet can still render without that pane.
      if (error instanceof RevenueAPIError && (error.status === 404 || error.status === 409)) {
        return [] as CommunicationTimelineItem[];
      }
      throw error;
    });

export const getCommunicationPolicy = (sourceAccountId: string, signal?: AbortSignal) =>
  viaRequest(() => fetchCommunicationPolicy(sourceAccountId, signal));

export const putCommunicationPolicy = (
  sourceAccountId: string,
  policy: Omit<CommunicationPolicy, "id" | "sourceAccountId" | "version">,
) =>
  call<CommunicationPolicy>(
    `/revenue-workspaces/current/communication-policy/${encodeURIComponent(sourceAccountId)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        metadataVisibility: policy.metadataVisibility,
        shareSubject: policy.shareSubject,
        shareBody: policy.shareBody,
        shareAttachments: policy.shareAttachments,
        signatureEnrichment: policy.signatureEnrichment,
        modelContactExtraction: policy.modelContactExtraction,
        retentionDays: policy.retentionDays,
      }),
    },
  );

export const listCommunicationPrivacyRules = (signal?: AbortSignal) =>
  viaRequest(() => fetchCommunicationPrivacyRules(signal));

export const createCommunicationPrivacyRule = (input: { kind: string; value: string }) =>
  call<CommunicationPrivacyRule>("/revenue-workspaces/current/communication-privacy-rules", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const deleteCommunicationPrivacyRule = (ruleId: string) =>
  call<void>(
    `/revenue-workspaces/current/communication-privacy-rules/${encodeURIComponent(ruleId)}`,
    {
      method: "DELETE",
    },
  );

export const getCommunicationInteractionBody = (interactionId: string) =>
  call<{ body: string }>(
    `/revenue-workspaces/current/communications/${encodeURIComponent(interactionId)}/body`,
  );

export const getRelationshipChanges = (id: string) =>
  call<{ snapshots: RelationshipStateSnapshot[] }>(`/relationships/${id}/changes`).then(
    (body) => body.snapshots ?? [],
  );

export const getRelationshipEvidence = (relationshipId: string, evidenceId: string) =>
  call<{ observation: RelationshipObservation; payload: unknown }>(
    `/relationships/${relationshipId}/evidence/${evidenceId}`,
  );

export const ingestRelationshipObservations = (
  observations: IngestRelationshipObservationsInput["observations"],
) => viaRequest(() => fetchIngestRelationshipObservations({ observations }));

export interface RelationshipCorrectionInput {
  dimension:
    | "lifecycle"
    | "engagement"
    | "sentiment"
    | "health"
    | "summary"
    | "next_action"
    | "risk"
    | "milestone";
  value: string;
  reason: string;
  supersedesAssertionId?: string;
  validTo?: string;
}

export const correctRelationship = (id: string, input: RelationshipCorrectionInput) =>
  viaRequest(() => fetchCorrectRelationship(id, input));

export const retractRelationshipAssertion = (
  relationshipId: string,
  assertionId: string,
  reason: string,
) => viaRequest(() => fetchRetractRelationshipAssertion(relationshipId, assertionId, { reason }));

export const correctConversationReview = (
  id: string,
  input: {
    reviewItemId: string;
    correctedValue: string;
    reason: string;
  },
) => viaRequest(() => fetchCorrectConversationEvidence(id, input));

export const decideConversationReview = (
  id: string,
  input: {
    reviewItemId: string;
    kind: "approve" | "correct" | "reject" | "defer";
    correctedValue?: string;
    reason?: string;
    deferUntil?: string;
  },
) => viaRequest(() => fetchDecideConversationChange(id, input));

export const resolveRelationshipContradiction = (
  id: string,
  caseId: string,
  input: { selectedAssertionId: string; reason?: string },
) => viaRequest(() => fetchResolveRelationshipContradiction(id, caseId, input));

export const runCommitmentRecovery = (id: string) =>
  viaRequest(() => fetchRunCommitmentRecovery(id, {}));

export const appendCommitmentTransition = (
  relationshipId: string,
  commitmentId: string,
  input: AppendCommitmentTransitionInput,
) => viaRequest(() => fetchAppendCommitmentTransition(relationshipId, commitmentId, input));

export const createMutualActionPlan = (
  relationshipId: string,
  commitmentIds: CreateMutualActionPlanInput["commitmentIds"],
) => viaRequest(() => fetchCreateMutualActionPlan(relationshipId, { commitmentIds }));

export const approveMutualActionPlan = (relationshipId: string, planId: string) =>
  viaRequest(() => fetchApproveMutualActionPlan(relationshipId, planId, {}));

export const shareMutualActionPlan = (relationshipId: string, planId: string) =>
  viaRequest(() => fetchShareMutualActionPlan(relationshipId, planId, {}));

export const requestConversationDeletion = (relationshipId: string, requestId: string) =>
  viaRequest(() => fetchRequestConversationDeletion(relationshipId, { requestId }));

/**
 * One cache entry for source health. The sidebar and the revenue panel both
 * read it, so a finished audit refreshes both with one invalidation.
 */
export { RELATIONSHIP_SOURCE_STATUS_QUERY_KEY };

export const listRelationshipSourceStatuses = fetchRelationshipSourceStatuses;

export const listRelationshipSources = (signal?: AbortSignal) =>
  viaRequest(() => fetchRelationshipSources(signal));

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
) => viaRequest(() => fetchReportRelationshipSourceAuthorization(source, input));

export const resyncRelationshipSource = (source: string, sourceAccountId: string) =>
  viaRequest(() => fetchResyncRelationshipSource(source, { sourceAccountId }));

export const disconnectRelationshipSource = (source: string, sourceAccountId: string) =>
  viaRequest(() => fetchDisconnectRelationshipSource(source, sourceAccountId));

export const listIdentityCandidates = (
  status = "pending",
  relationshipId?: string,
  signal?: AbortSignal,
) => viaRequest(() => fetchIdentityCandidates(status, relationshipId, signal));

export const decideIdentityCandidate = (
  candidateId: string,
  input: DecideRelationshipIdentityCandidateInput,
) => viaRequest(() => fetchDecideRelationshipIdentityCandidate(candidateId, input));

export const listRelationshipAttention = (status = "open", signal?: AbortSignal) =>
  viaRequest(() => fetchRelationshipAttention(status, signal));

export const decideRelationshipAttention = (
  attentionId: string,
  input: {
    decision: "acknowledge" | "snooze" | "dismiss";
    reason: string;
    expectedVersion: number;
    snoozedUntil?: string;
  },
) => viaRequest(() => fetchDecideRelationshipAttention(attentionId, input));

export const approveRecommendation = (actionId: string, acceptRisk = false) =>
  viaRequest(() => fetchApproveRelationshipRecommendation(actionId, { acceptRisk }));

export const rejectRecommendation = (actionId: string, reason: string) =>
  viaRequest(() => fetchRejectRelationshipRecommendation(actionId, { reason }));

export type CreateRelationshipInput = CreateRelationshipMutationInput;

export const createRelationship = (input: CreateRelationshipInput) =>
  viaRequest(() => fetchCreateRelationship(input));

// --- lifecycle ---------------------------------------------------------------

export type EditActionInput = EditRevenueActionInput;

export const editAction = (actionId: string, input: EditActionInput) =>
  viaRequest(() => fetchEditRevenueAction(actionId, input));

export const evaluateAction = (actionId: string) =>
  viaRequest(() => fetchEvaluateRevenueAction(actionId));

export const approveAction = (actionId: string, acceptRisk = false) =>
  viaRequest(() => fetchApproveRevenueAction(actionId, { acceptRisk }));

export const rejectAction = (actionId: string, reason: string) =>
  viaRequest(() => fetchRejectRevenueAction(actionId, { reason }));

export const executeAction = (actionId: string) =>
  viaRequest(() => fetchExecuteRevenueAction(actionId));

export const snoozeAction = (actionId: string, until: string) =>
  viaRequest(() => fetchSnoozeRevenueAction(actionId, { until }));

export const dismissAction = (actionId: string, reason: string) =>
  viaRequest(() => fetchDismissRevenueAction(actionId, { reason }));

export type RecordOutcomeInput = RecordRevenueActionOutcomeInput;
export type { DecideRelationshipIdentityCandidateInput };

export const recordOutcome = (actionId: string, input: RecordOutcomeInput) =>
  viaRequest(() => fetchRecordRevenueActionOutcome(actionId, input));

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
export const MANUAL_OUTCOMES: { value: RecordOutcomeInput["kind"]; label: string }[] = [
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

export function relativeTime(iso?: string | null): string {
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

// --- the commitment register -------------------------------------------------
//
// One route, five views. Before this existed the register was assembled in the
// browser from relationship-graph nodes, which could not page, could not filter
// server-side, and could not answer "by owner" or "what changed" at all.

export async function listCommitments(
  filter: CommitmentRegisterFilter = {},
  signal?: AbortSignal,
): Promise<RegisterEntry[]> {
  return viaRequest(() => fetchCommitments(filter, signal));
}

export async function getCommitmentRecord(
  commitmentId: string,
  signal?: AbortSignal,
): Promise<CommitmentRecord> {
  const record = parsed(
    ExportCommitment200Response,
    await call<unknown>(`/commitments/${encodeURIComponent(commitmentId)}/export`, { signal }),
    "commitment record",
  );
  return { ...record, dueAt: record.dueAt ?? undefined } as CommitmentRecord;
}

/** The Markdown document a user forwards. Returned as text, not JSON. */
export async function getCommitmentRecordMarkdown(commitmentId: string): Promise<string> {
  const res = await dashboardRequest(
    toDashboardAPIPath(`/commitments/${encodeURIComponent(commitmentId)}/export?format=md`),
  );
  redirectBrowserIfUnauthorized(res.status);
  if (!res.ok) {
    throw new RevenueAPIError(`Export failed (${res.status})`, res.status);
  }
  return res.text();
}

export const getOpenPromisesReport = fetchOpenPromisesReport;

export async function getOpenPromisesReportMarkdown(scanId: string): Promise<string> {
  const res = await dashboardRequest(
    toDashboardAPIPath(`/revenue-leak-scans/${encodeURIComponent(scanId)}/report?format=md`),
  );
  redirectBrowserIfUnauthorized(res.status);
  if (!res.ok) throw new RevenueAPIError(`Report export failed (${res.status})`, res.status);
  return res.text();
}
