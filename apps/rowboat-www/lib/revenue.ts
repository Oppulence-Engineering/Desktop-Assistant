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
import type { RelationshipListScope } from "@/hooks/queries/utils/relationship-keys";
import { RELATIONSHIP_SOURCE_STATUS_QUERY_KEY } from "@/hooks/queries/utils/relationship-source-keys";
import { DashboardRequestError } from "@/lib/api/request-json";
import {
  dashboardRequest,
  redirectBrowserIfUnauthorized,
  toDashboardAPIPath,
} from "@/lib/auth/dashboard-fetch";
import { ExportCommitment200Response } from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { StartRevenueLeakScan202Response } from "@/lib/api/generated/zod/revenue/revenue";
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
  OpenPromisesReport,
  RegisterEntry,
} from "@/types/revenue";

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

const post = (path: string, body?: unknown) =>
  call(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

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

export interface LinkWorkspaceInput {
  outboundOrganizationId?: string;
  outboundWorkspaceId: string;
}

export const linkWorkspace = (input: LinkWorkspaceInput) =>
  post("/revenue-workspaces/link", input) as Promise<RevenueWorkspace>;

// --- scan --------------------------------------------------------------------

export const startScan = async (lookbackDays?: number): Promise<RevenueLeakScan> =>
  parsed(
    StartRevenueLeakScan202Response,
    await post("/revenue-leak-scans", lookbackDays ? { lookbackDays } : undefined),
    "revenue scan",
  ) as RevenueLeakScan;

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
  dueAt?: string;
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
  post(`/relationships/${id}/acknowledgements`, { stateVersion, stateHash }) as Promise<{
    id: string;
    stateVersion: number;
    stateHash: string;
    acknowledgedAt: string;
  }>;

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

export const listIdentityCandidates = (
  status = "pending",
  relationshipId?: string,
  signal?: AbortSignal,
) => viaRequest(() => fetchIdentityCandidates(status, relationshipId, signal));

export const decideIdentityCandidate = (
  candidateId: string,
  input: { decision: string; reason: string; expectedVersion: number; idempotencyKey: string },
) =>
  post(
    `/relationship-identity-candidates/${encodeURIComponent(candidateId)}/decisions`,
    input,
  ) as Promise<RelationshipIdentityCandidate>;

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
