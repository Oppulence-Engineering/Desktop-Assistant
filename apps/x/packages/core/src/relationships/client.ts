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
