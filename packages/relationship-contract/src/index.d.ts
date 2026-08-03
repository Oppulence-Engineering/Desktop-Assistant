export const MISSION_CONTROL_QUESTIONS: readonly [
  { readonly key: "state"; readonly label: "What is true now?" },
  { readonly key: "change"; readonly label: "What changed?" },
  { readonly key: "evidence"; readonly label: "Why should I trust it?" },
  { readonly key: "action"; readonly label: "What should happen next?" },
];
export const RELATIONSHIP_CLIENT_CAPABILITIES: readonly string[];
export const RELATIONSHIP_GRAPH_CONTRACT_VERSION: "2026-08-01";
export type RelationshipGraphNodeKind =
  | "relationship"
  | "person"
  | "commitment"
  | "risk"
  | "milestone"
  | "action"
  | "evidence"
  | "source"
  | "note";
export type RelationshipGraphEdgeKind =
  | "participant_of"
  | "owns"
  | "has_commitment"
  | "blocks"
  | "requires"
  | "supersedes"
  | "has_risk"
  | "has_milestone"
  | "recommended_for"
  | "supports"
  | "contradicts"
  | "observed_from"
  | "linked_note";
export const RELATIONSHIP_GRAPH_NODE_KINDS: readonly RelationshipGraphNodeKind[];
export const RELATIONSHIP_GRAPH_EDGE_KINDS: readonly RelationshipGraphEdgeKind[];
export interface RelationshipGraphQueryFilters {
  nodeKinds: RelationshipGraphNodeKind[];
  lifecycle: string[];
  health: string[];
  approvalStatus: string[];
  sources: string[];
  edgeKinds: RelationshipGraphEdgeKind[];
  overdue: boolean;
  stale: boolean;
  changed: boolean;
  hideIsolated: boolean;
  freeText: string[];
}
export interface RelationshipGraphQueryParseResult {
  raw: string;
  normalized: string;
  filters: RelationshipGraphQueryFilters;
  applied: string[];
}
export interface RelationshipGraphLikeNode {
  id: string;
  kind: RelationshipGraphNodeKind;
  label: string;
  relationshipId?: string;
  relationshipIds?: string[];
  summary?: string;
  status?: string;
  role?: string;
  source?: string;
  lifecycle?: string;
  health?: string;
  approvalStatus?: string;
  freshness?: string;
  dueAt?: string;
  changedSinceReview?: boolean;
  evidenceRefs?: string[];
  [key: string]: unknown;
}
export interface RelationshipGraphLikeEdge {
  id: string;
  source: string;
  target: string;
  kind: RelationshipGraphEdgeKind;
  evidenceRefs?: string[];
  [key: string]: unknown;
}
export interface RelationshipGraphLike {
  asOf?: string;
  nodes: RelationshipGraphLikeNode[];
  edges: RelationshipGraphLikeEdge[];
}
export function parseRelationshipGraphQuery(query: string): RelationshipGraphQueryParseResult;
export function queryRelationshipGraph(
  graph: RelationshipGraphLike,
  query: string,
  options?: { asOf?: string },
): {
  parsed: RelationshipGraphQueryParseResult;
  answer: string;
  relationshipIds: string[];
  matchedNodeIds: string[];
  visibleNodeIds: string[];
  matchedEdgeIds: string[];
  evidenceRefs: string[];
};
export function relationshipGraphNeighborhood(
  graph: RelationshipGraphLike,
  rootNodeId: string,
  depth?: number,
): {
  rootNodeId: string;
  depth: number;
  nodeIds: string[];
  edgeIds: string[];
  boundaryNodeIds: string[];
};
export interface RelationshipGraphSavedViewState {
  scope: "portfolio" | "relationship";
  relationshipId?: string;
  query: string;
  layout: "force" | "radial" | "timeline";
  density: number;
  hideIsolated: boolean;
  selectedNodeId?: string;
  focusDepth: 0 | 1 | 2;
  asOf?: string;
  changedSinceReview: boolean;
}
export interface RelationshipGraphSavedView {
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  state: RelationshipGraphSavedViewState;
}
export function createRelationshipGraphSavedView(input: {
  id?: string;
  label?: string;
  createdAt?: string;
  updatedAt?: string;
  state?: Partial<RelationshipGraphSavedViewState>;
}): RelationshipGraphSavedView;
export const RELATIONSHIP_DIMENSION_LABELS: Record<string, string>;
export const COMPLETENESS_LABELS: Record<string, string>;
export const AUTHORITY_LABELS: Record<string, string>;
export function relationshipLabel(value?: string): string;
export function completenessTone(status: string): "safe" | "caution" | "blocked";
export interface ImportedTranscriptObservationInput {
  relationshipId: string;
  title?: string;
  transcript: string;
  occurredAt?: string;
  sourceRecordId?: string;
  participantDisclosure?: string;
}
export interface ImportedTranscriptObservation {
  relationshipId: string;
  source: "meeting";
  sourceAccountId: "upload";
  externalId: string;
  sourceVersion: string;
  eventType: "conversation_evidence_compiled";
  occurredAt: string;
  summary: string;
  normalizedFacts: Record<string, unknown>;
  payload: Record<string, unknown>;
  assertions: [];
}
export function buildImportedTranscriptObservation(
  input: ImportedTranscriptObservationInput,
): ImportedTranscriptObservation;
