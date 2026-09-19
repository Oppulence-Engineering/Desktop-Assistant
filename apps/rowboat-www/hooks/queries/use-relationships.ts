"use client";

import "client-only";

import { useQuery } from "@tanstack/react-query";

import {
  fetchIdentityCandidates,
  fetchPersons,
  fetchRelationshipAttention,
  fetchRelationshipGraph,
  fetchRelationships,
  fetchSemanticSearch,
} from "@/hooks/queries/utils/fetch-relationships";
import {
  RELATIONSHIP_GRAPH_STALE_TIME,
  RELATIONSHIP_LIST_STALE_TIME,
  RELATIONSHIP_SEARCH_STALE_TIME,
  relationshipKeys,
  type RelationshipGraphScope,
  type RelationshipListScope,
} from "@/hooks/queries/utils/relationship-keys";

export function useRelationships(filters: RelationshipListScope = {}, enabled = true) {
  return useQuery({
    queryKey: relationshipKeys.list(filters),
    queryFn: ({ signal }) => fetchRelationships(filters, signal),
    staleTime: RELATIONSHIP_LIST_STALE_TIME,
    enabled,
  });
}

export function useRelationshipGraph(input: RelationshipGraphScope, enabled = true) {
  return useQuery({
    queryKey: relationshipKeys.graph(input),
    queryFn: ({ signal }) => fetchRelationshipGraph(input, signal),
    staleTime: RELATIONSHIP_GRAPH_STALE_TIME,
    enabled,
  });
}

export function useIdentityCandidates(status: string, relationshipId?: string) {
  return useQuery({
    queryKey: relationshipKeys.identity(status, relationshipId),
    queryFn: ({ signal }) => fetchIdentityCandidates(status, relationshipId, signal),
    staleTime: RELATIONSHIP_LIST_STALE_TIME,
  });
}

export function useRelationshipAttention(status = "open") {
  return useQuery({
    queryKey: relationshipKeys.attention(status),
    queryFn: ({ signal }) => fetchRelationshipAttention(status, signal),
    staleTime: RELATIONSHIP_LIST_STALE_TIME,
  });
}

export function useSemanticSearch(query: string, enabled: boolean) {
  return useQuery({
    queryKey: relationshipKeys.search(query),
    queryFn: ({ signal }) => fetchSemanticSearch(query, signal),
    staleTime: RELATIONSHIP_SEARCH_STALE_TIME,
    enabled,
  });
}

export function usePersons(query = "", enabled = true) {
  return useQuery({
    queryKey: relationshipKeys.persons(query),
    queryFn: ({ signal }) => fetchPersons(query, signal),
    staleTime: RELATIONSHIP_LIST_STALE_TIME,
    enabled,
  });
}
