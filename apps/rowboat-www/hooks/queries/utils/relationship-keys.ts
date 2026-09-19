export type RelationshipListScope = {
  q?: string;
  lifecycle?: string;
  health?: string;
  engagement?: string;
};

export type RelationshipGraphScope = {
  scope: "portfolio" | "relationship";
  relationshipId?: string;
  depth?: 1 | 2 | 3;
  asOf?: string;
};

export const relationshipKeys = {
  all: ["relationship"] as const,
  lists: () => [...relationshipKeys.all, "list"] as const,
  list: (scope: RelationshipListScope = {}) => [...relationshipKeys.lists(), scope] as const,
  graphs: () => [...relationshipKeys.all, "graph"] as const,
  graph: (scope: RelationshipGraphScope) => [...relationshipKeys.graphs(), scope] as const,
  identity: (status: string, relationshipId?: string) =>
    [...relationshipKeys.all, "identity", status, relationshipId ?? ""] as const,
  attention: (status: string) => [...relationshipKeys.all, "attention", status] as const,
  search: (query: string) => [...relationshipKeys.all, "search", query] as const,
  persons: (query = "") => [...relationshipKeys.all, "persons", query] as const,
};

export const RELATIONSHIP_LIST_STALE_TIME = 15_000;
export const RELATIONSHIP_GRAPH_STALE_TIME = 15_000;
export const RELATIONSHIP_SEARCH_STALE_TIME = 10_000;
