import { z } from "zod";

import { ListRelationships200Response } from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { DashboardRequestError, requestJson, type RequestJsonFn } from "@/lib/api/request-json";
import { mapSettledWithConcurrency } from "@/lib/revenue-records";
import { RelationshipGraphSchema } from "@/types/revenue";
import type {
  RelationshipAttentionItem,
  RelationshipGraph,
  RelationshipIdentityCandidate,
  RelationshipPerson,
  RevenueRelationship,
} from "@/types/revenue";
import type {
  RelationshipGraphScope,
  RelationshipListScope,
} from "@/hooks/queries/utils/relationship-keys";

const IdentityListSchema = z.object({
  candidates: z.array(z.unknown()).optional(),
});

const AttentionListSchema = z.object({
  items: z.array(z.unknown()).optional(),
});

const PersonListSchema = z.object({
  persons: z.array(z.unknown()).optional(),
});

const SemanticSearchSchema = z.object({
  available: z.boolean(),
  matches: z
    .array(
      z.object({
        threadId: z.string(),
        subject: z.string(),
        counterparty: z.string(),
        classification: z.string(),
        summary: z.string(),
        score: z.number(),
      }),
    )
    .default([]),
});

export type SemanticMatch = z.infer<typeof SemanticSearchSchema>["matches"][number];

function relationshipsPath(filters: RelationshipListScope = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.size ? `?${params.toString()}` : "";
  return `/relationships${query}`;
}

function graphPath(input: RelationshipGraphScope): string {
  const params = new URLSearchParams({ scope: input.scope });
  if (input.relationshipId) params.set("relationshipId", input.relationshipId);
  if (input.depth) params.set("depth", String(input.depth));
  if (input.asOf) params.set("asOf", input.asOf);
  return `/relationships/graph?${params.toString()}`;
}

export async function loadRelationships(
  request: RequestJsonFn,
  filters: RelationshipListScope = {},
  signal?: AbortSignal,
): Promise<RevenueRelationship[]> {
  const body = await request({
    path: relationshipsPath(filters),
    schema: ListRelationships200Response,
    signal,
  });
  return (body.relationships ?? []) as RevenueRelationship[];
}

async function requestGraph(
  request: RequestJsonFn,
  input: RelationshipGraphScope,
  signal?: AbortSignal,
): Promise<RelationshipGraph> {
  return request({
    path: graphPath(input),
    schema: RelationshipGraphSchema,
    signal,
  });
}

/**
 * Portfolio graphs on older APIs reject a missing relationshipId. Fan out
 * only in that case so a modern server is not asked for N relationship graphs.
 */
export async function loadRelationshipGraph(
  request: RequestJsonFn,
  input: RelationshipGraphScope,
  signal?: AbortSignal,
): Promise<RelationshipGraph> {
  try {
    return await requestGraph(request, input, signal);
  } catch (error) {
    const legacyPortfolioEndpoint =
      input.scope === "portfolio" &&
      error instanceof DashboardRequestError &&
      error.status === 400 &&
      /relationshipId/i.test(error.message);
    if (!legacyPortfolioEndpoint) throw error;

    const relationships = await loadRelationships(request, {}, signal);
    const graphResults = await mapSettledWithConcurrency(relationships, 4, (relationship) =>
      requestGraph(
        request,
        { ...input, scope: "relationship", relationshipId: relationship.id },
        signal,
      ),
    );
    const failures = graphResults.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failures.length > 0) {
      throw new DashboardRequestError(
        `Could not build a complete portfolio graph: ${failures.length} of ${relationships.length} relationship requests failed.`,
        502,
        "partial_relationship_graph",
      );
    }
    const graphs = graphResults.map(
      (result) => (result as PromiseFulfilledResult<RelationshipGraph>).value,
    );
    const generatedAt = graphs.reduce(
      (latest, graph) => (graph.generatedAt > latest ? graph.generatedAt : latest),
      new Date().toISOString(),
    );
    return RelationshipGraphSchema.parse({
      contractVersion: "2026-08-01",
      generatedAt,
      asOf: input.asOf || generatedAt,
      historical: Boolean(input.asOf),
      scope: "portfolio",
      depth: input.depth || 2,
      nodes: [
        ...new Map(graphs.flatMap((graph) => graph.nodes).map((node) => [node.id, node])).values(),
      ],
      edges: [
        ...new Map(graphs.flatMap((graph) => graph.edges).map((edge) => [edge.id, edge])).values(),
      ],
      permissions: graphs.length
        ? {
            canView: graphs.every((graph) => graph.permissions.canView),
            canContribute: graphs.every((graph) => graph.permissions.canContribute),
            canApprove: graphs.every((graph) => graph.permissions.canApprove),
            canExecute: graphs.every((graph) => graph.permissions.canExecute),
            canSaveViews: graphs.every((graph) => graph.permissions.canSaveViews),
          }
        : {
            canView: true,
            canContribute: false,
            canApprove: false,
            canExecute: false,
            canSaveViews: false,
          },
    });
  }
}

export async function loadIdentityCandidates(
  request: RequestJsonFn,
  status = "pending",
  relationshipId?: string,
  signal?: AbortSignal,
): Promise<RelationshipIdentityCandidate[]> {
  const params = new URLSearchParams({ status });
  if (relationshipId) params.set("relationshipId", relationshipId);
  const body = await request({
    path: `/relationship-identity-candidates?${params.toString()}`,
    schema: IdentityListSchema,
    signal,
  });
  return (body.candidates ?? []) as RelationshipIdentityCandidate[];
}

export async function loadRelationshipAttention(
  request: RequestJsonFn,
  status = "open",
  signal?: AbortSignal,
): Promise<RelationshipAttentionItem[]> {
  const body = await request({
    path: `/relationship-attention?status=${encodeURIComponent(status)}`,
    schema: AttentionListSchema,
    signal,
  });
  return (body.items ?? []) as RelationshipAttentionItem[];
}

export async function loadSemanticSearch(
  request: RequestJsonFn,
  query: string,
  signal?: AbortSignal,
): Promise<{ available: boolean; matches: SemanticMatch[] }> {
  const params = new URLSearchParams({ q: query });
  return request({
    path: `/revenue-search?${params.toString()}`,
    schema: SemanticSearchSchema,
    signal,
  });
}

export function fetchRelationships(
  filters: RelationshipListScope = {},
  signal?: AbortSignal,
): Promise<RevenueRelationship[]> {
  return loadRelationships(requestJson, filters, signal);
}

export function fetchRelationshipGraph(
  input: RelationshipGraphScope,
  signal?: AbortSignal,
): Promise<RelationshipGraph> {
  return loadRelationshipGraph(requestJson, input, signal);
}

export function fetchIdentityCandidates(
  status = "pending",
  relationshipId?: string,
  signal?: AbortSignal,
): Promise<RelationshipIdentityCandidate[]> {
  return loadIdentityCandidates(requestJson, status, relationshipId, signal);
}

export function fetchRelationshipAttention(
  status = "open",
  signal?: AbortSignal,
): Promise<RelationshipAttentionItem[]> {
  return loadRelationshipAttention(requestJson, status, signal);
}

export function fetchSemanticSearch(
  query: string,
  signal?: AbortSignal,
): Promise<{ available: boolean; matches: SemanticMatch[] }> {
  return loadSemanticSearch(requestJson, query, signal);
}

export async function loadPersons(
  request: RequestJsonFn,
  query = "",
  signal?: AbortSignal,
): Promise<RelationshipPerson[]> {
  const params = new URLSearchParams({ limit: "500" });
  if (query.trim()) params.set("q", query.trim());
  const body = await request({
    path: `/relationship-persons?${params.toString()}`,
    schema: PersonListSchema,
    signal,
  });
  return (body.persons ?? []) as RelationshipPerson[];
}

export function fetchPersons(query = "", signal?: AbortSignal): Promise<RelationshipPerson[]> {
  return loadPersons(requestJson, query, signal);
}
