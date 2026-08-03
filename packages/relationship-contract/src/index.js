export const MISSION_CONTROL_QUESTIONS = [
  { key: "state", label: "What is true now?" },
  { key: "change", label: "What changed?" },
  { key: "evidence", label: "Why should I trust it?" },
  { key: "action", label: "What should happen next?" },
];

// User-facing RFC 038 capabilities that must remain reachable in both clients.
// Platform-specific capture mechanics may differ, but both clients must expose a
// path to publish reviewed transcript evidence into the same relationship state.
export const RELATIONSHIP_CLIENT_CAPABILITIES = [
  "source-lifecycle",
  "identity-review",
  "mission-control",
  "evidence-inspection",
  "state-correction",
  "assertion-retraction",
  "conversation-review",
  "contradiction-resolution",
  "commitment-management",
  "mutual-action-plans",
  "attention-queue",
  "governed-actions",
  "action-audit",
  "outcome-observation",
  "transcript-publication",
  "privacy-deletion",
  "support-diagnostics",
  "relationship-graph",
  "graph-query",
  "graph-saved-views",
  "graph-governed-actions",
];

export const RELATIONSHIP_GRAPH_CONTRACT_VERSION = "2026-08-01";

export const RELATIONSHIP_GRAPH_NODE_KINDS = [
  "relationship",
  "person",
  "commitment",
  "risk",
  "milestone",
  "action",
  "evidence",
  "source",
  "note",
];

export const RELATIONSHIP_GRAPH_EDGE_KINDS = [
  "participant_of",
  "owns",
  "has_commitment",
  "blocks",
  "requires",
  "supersedes",
  "has_risk",
  "has_milestone",
  "recommended_for",
  "supports",
  "contradicts",
  "observed_from",
  "linked_note",
];

const GRAPH_QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "from",
  "in",
  "is",
  "me",
  "of",
  "on",
  "show",
  "that",
  "the",
  "this",
  "to",
  "what",
  "which",
  "who",
  "with",
]);

const GRAPH_QUERY_NODE_ALIASES = {
  account: "relationship",
  accounts: "relationship",
  relationship: "relationship",
  relationships: "relationship",
  people: "person",
  person: "person",
  contacts: "person",
  commitment: "commitment",
  commitments: "commitment",
  promise: "commitment",
  promises: "commitment",
  risk: "risk",
  risks: "risk",
  milestone: "milestone",
  milestones: "milestone",
  action: "action",
  actions: "action",
  recommendation: "action",
  recommendations: "action",
  evidence: "evidence",
  observation: "evidence",
  observations: "evidence",
  source: "source",
  sources: "source",
  note: "note",
  notes: "note",
};

const GRAPH_QUERY_LIFECYCLES = [
  "prospect",
  "evaluation",
  "contracting",
  "onboarding",
  "active_customer",
  "renewal",
  "churned",
  "former_customer",
];

const GRAPH_QUERY_HEALTH = ["healthy", "needs_attention", "critical", "unknown"];
const GRAPH_QUERY_SOURCES = [
  "gmail",
  "calendar",
  "slack",
  "hubspot",
  "meeting",
  "desktop_note",
  "voice_note",
  "browser",
  "crm",
  "user",
];

const normalizedGraphValue = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const graphNodeRelationshipIds = (node) => {
  if (node.kind === "relationship") return [node.id.replace(/^relationship:/, "")];
  const ids = Array.isArray(node.relationshipIds) ? node.relationshipIds : [];
  if (node.relationshipId && !ids.includes(node.relationshipId))
    return [node.relationshipId, ...ids];
  return ids;
};

/**
 * Parse a bounded, explainable natural-language graph query. This parser is
 * deliberately deterministic: it never invents graph facts and every applied
 * filter is returned to the UI for inspection.
 */
export function parseRelationshipGraphQuery(query) {
  const raw = String(query || "").trim();
  const normalized = raw.toLowerCase().replaceAll("-", "_");
  const filters = {
    nodeKinds: [],
    lifecycle: [],
    health: [],
    approvalStatus: [],
    sources: [],
    edgeKinds: [],
    overdue: /\boverdue\b/.test(normalized),
    stale: /\bstale\b|\boutdated\b/.test(normalized),
    changed: /\bchanged\b|\bsince (?:my )?last review\b/.test(normalized),
    hideIsolated: /\bconnected\b|\bhide isolated\b/.test(normalized),
    freeText: [],
  };

  for (const [alias, kind] of Object.entries(GRAPH_QUERY_NODE_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(normalized) && !filters.nodeKinds.includes(kind)) {
      filters.nodeKinds.push(kind);
    }
  }
  for (const lifecycle of GRAPH_QUERY_LIFECYCLES) {
    const aliases = lifecycle === "renewal" ? ["renewal", "renewals", "renewing"] : [lifecycle];
    if (aliases.some((alias) => new RegExp(`\\b${alias}\\b`).test(normalized))) {
      filters.lifecycle.push(lifecycle);
    }
  }
  if (/\bneeds attention\b|\bat risk\b/.test(normalized)) filters.health.push("needs_attention");
  for (const health of GRAPH_QUERY_HEALTH) {
    if (new RegExp(`\\b${health.replaceAll("_", "[ _]")}\\b`).test(normalized)) {
      filters.health.push(health);
    }
  }
  for (const status of ["pending", "approved", "rejected"]) {
    if (new RegExp(`\\b${status}\\b`).test(normalized)) filters.approvalStatus.push(status);
  }
  for (const source of GRAPH_QUERY_SOURCES) {
    if (new RegExp(`\\b${source.replaceAll("_", "[ _]")}\\b`).test(normalized)) {
      filters.sources.push(source);
    }
  }
  if (/\bdepend(?:s|ent)?\b|\brequires?\b/.test(normalized)) {
    filters.edgeKinds.push("requires");
  }
  if (/\bblocks?|\bblocked\b/.test(normalized)) filters.edgeKinds.push("blocks");
  if (/\bcontradict(?:s|ed|ion)?\b/.test(normalized)) filters.edgeKinds.push("contradicts");

  const recognized = new Set([
    ...Object.keys(GRAPH_QUERY_NODE_ALIASES),
    ...GRAPH_QUERY_LIFECYCLES.flatMap((value) => value.split("_")),
    ...GRAPH_QUERY_HEALTH.flatMap((value) => value.split("_")),
    ...GRAPH_QUERY_SOURCES.flatMap((value) => value.split("_")),
    "attention",
    "at",
    "approved",
    "blocked",
    "changed",
    "connected",
    "critical",
    "depend",
    "depends",
    "hide",
    "isolated",
    "last",
    "outdated",
    "overdue",
    "pending",
    "rejected",
    "renewal",
    "renewals",
    "renewing",
    "review",
    "stale",
  ]);
  filters.freeText = normalized
    .replace(/[^a-z0-9_@.\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !GRAPH_QUERY_STOP_WORDS.has(token) && !recognized.has(token));

  const applied = [];
  if (filters.lifecycle.length) applied.push(`lifecycle: ${filters.lifecycle.join(", ")}`);
  if (filters.health.length) applied.push(`health: ${filters.health.join(", ")}`);
  if (filters.nodeKinds.length) applied.push(`nodes: ${filters.nodeKinds.join(", ")}`);
  if (filters.approvalStatus.length) {
    applied.push(`approval: ${filters.approvalStatus.join(", ")}`);
  }
  if (filters.sources.length) applied.push(`sources: ${filters.sources.join(", ")}`);
  if (filters.edgeKinds.length) applied.push(`edges: ${filters.edgeKinds.join(", ")}`);
  if (filters.overdue) applied.push("overdue commitments");
  if (filters.stale) applied.push("stale evidence");
  if (filters.changed) applied.push("changed since review");
  if (filters.freeText.length) applied.push(`text: ${filters.freeText.join(" ")}`);

  return { raw, normalized, filters, applied };
}

const graphSetIntersection = (left, right) =>
  new Set([...left].filter((value) => right.has(value)));

/** Apply a natural-language query to an evidence-bearing relationship graph. */
export function queryRelationshipGraph(graph, query, options = {}) {
  const parsed = parseRelationshipGraphQuery(query);
  const { filters } = parsed;
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const asOf = new Date(options.asOf || graph?.asOf || Date.now());
  const allRelationshipIds = new Set(
    nodes.flatMap(graphNodeRelationshipIds).filter((value) => typeof value === "string" && value),
  );
  let relationshipIds = new Set(allRelationshipIds);
  let constrained = false;
  const matched = new Set();

  const constrainBy = (predicate) => {
    const ids = new Set();
    for (const node of nodes) {
      if (!predicate(node)) continue;
      matched.add(node.id);
      for (const relationshipId of graphNodeRelationshipIds(node)) ids.add(relationshipId);
    }
    relationshipIds = constrained ? graphSetIntersection(relationshipIds, ids) : ids;
    constrained = true;
  };

  if (filters.lifecycle.length) {
    constrainBy(
      (node) =>
        node.kind === "relationship" &&
        filters.lifecycle.includes(normalizedGraphValue(node.lifecycle)),
    );
  }
  if (filters.health.length) {
    constrainBy(
      (node) =>
        node.kind === "relationship" && filters.health.includes(normalizedGraphValue(node.health)),
    );
  }
  if (filters.overdue) {
    constrainBy((node) => {
      if (node.kind !== "commitment" || normalizedGraphValue(node.status) === "completed")
        return false;
      const dueAt = node.dueAt ? new Date(node.dueAt) : null;
      return Boolean(dueAt && Number.isFinite(dueAt.getTime()) && dueAt < asOf);
    });
  }
  if (filters.approvalStatus.length) {
    constrainBy(
      (node) =>
        node.kind === "action" &&
        filters.approvalStatus.includes(normalizedGraphValue(node.approvalStatus)),
    );
  }
  if (filters.sources.length) {
    constrainBy((node) => filters.sources.includes(normalizedGraphValue(node.source)));
  }
  if (filters.stale) {
    constrainBy((node) => normalizedGraphValue(node.freshness) === "stale");
  }
  if (filters.changed) {
    constrainBy((node) => node.kind === "relationship" && Boolean(node.changedSinceReview));
  }
  if (filters.freeText.length) {
    constrainBy((node) => {
      const haystack = [node.label, node.summary, node.status, node.role, node.source]
        .map(normalizedGraphValue)
        .join(" ");
      return filters.freeText.every((token) => haystack.includes(token));
    });
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  if (filters.edgeKinds.length) {
    const ids = new Set();
    for (const edge of edges) {
      if (!filters.edgeKinds.includes(edge.kind)) continue;
      matched.add(edge.source);
      matched.add(edge.target);
      for (const endpoint of [nodesById.get(edge.source), nodesById.get(edge.target)]) {
        if (!endpoint) continue;
        for (const relationshipId of graphNodeRelationshipIds(endpoint)) ids.add(relationshipId);
      }
    }
    relationshipIds = constrained ? graphSetIntersection(relationshipIds, ids) : ids;
    constrained = true;
  }

  if (!constrained && filters.nodeKinds.length) {
    for (const node of nodes) {
      if (filters.nodeKinds.includes(node.kind)) matched.add(node.id);
    }
  }

  // Each individual constraint can find useful nodes while their relationship sets have no
  // overlap. Only keep nodes that belong to the final intersection; otherwise a zero-result
  // answer can still render unrelated accounts and evidence in the client.
  if (constrained) {
    for (const nodeId of [...matched]) {
      const node = nodesById.get(nodeId);
      if (
        !node ||
        !graphNodeRelationshipIds(node).some((relationshipId) =>
          relationshipIds.has(relationshipId),
        )
      ) {
        matched.delete(nodeId);
      }
    }
  }

  const relationshipNodeIds = new Set(
    nodes
      .filter(
        (node) =>
          node.kind === "relationship" &&
          graphNodeRelationshipIds(node).some((id) => relationshipIds.has(id)),
      )
      .map((node) => node.id),
  );
  for (const id of relationshipNodeIds) matched.add(id);

  const qualifyingKinds = new Set(filters.nodeKinds);
  for (const node of nodes) {
    const nodeRelationshipIds = graphNodeRelationshipIds(node);
    if (!nodeRelationshipIds.some((id) => relationshipIds.has(id))) continue;
    if (!qualifyingKinds.size || qualifyingKinds.has(node.kind) || node.kind === "relationship") {
      matched.add(node.id);
    }
  }

  const edgeKindCandidates = new Set(
    edges
      .filter((edge) => !filters.edgeKinds.length || filters.edgeKinds.includes(edge.kind))
      .map((edge) => edge.id),
  );
  const visible = new Set(matched);
  for (const edge of edges) {
    if (filters.edgeKinds.length && !edgeKindCandidates.has(edge.id)) continue;
    if (matched.has(edge.source) || matched.has(edge.target)) {
      visible.add(edge.source);
      visible.add(edge.target);
    }
  }
  const matchedEdgeIds = new Set(
    edges
      .filter(
        (edge) =>
          edgeKindCandidates.has(edge.id) && (matched.has(edge.source) || matched.has(edge.target)),
      )
      .map((edge) => edge.id),
  );
  const evidenceRefs = [
    ...new Set([
      ...nodes
        .filter((node) => matched.has(node.id))
        .flatMap((node) => (Array.isArray(node.evidenceRefs) ? node.evidenceRefs : [])),
      ...edges
        .filter(
          (edge) =>
            matchedEdgeIds.has(edge.id) && (matched.has(edge.source) || matched.has(edge.target)),
        )
        .flatMap((edge) => (Array.isArray(edge.evidenceRefs) ? edge.evidenceRefs : [])),
    ]),
  ];
  const relationshipCount = relationshipIds.size;
  const answer = constrained
    ? `${relationshipCount} relationship${relationshipCount === 1 ? "" : "s"} match${relationshipCount === 1 ? "es" : ""} ${parsed.applied.join(" · ") || "the query"}.`
    : parsed.raw
      ? `${matched.size} graph item${matched.size === 1 ? "" : "s"} match the query.`
      : "Showing the complete graph.";

  return {
    parsed,
    answer,
    relationshipIds: [...relationshipIds],
    matchedNodeIds: [...matched],
    visibleNodeIds: [...visible],
    matchedEdgeIds: [...matchedEdgeIds],
    evidenceRefs,
  };
}

/** Return a deterministic, induced neighborhood around one graph node. */
export function relationshipGraphNeighborhood(graph, rootNodeId, depth = 1) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const normalizedRootNodeId = String(rootNodeId || "");
  const normalizedDepth = Math.max(1, Math.min(3, Math.trunc(Number(depth) || 1)));
  if (!nodes.some((node) => node.id === normalizedRootNodeId)) {
    return {
      rootNodeId: normalizedRootNodeId,
      depth: normalizedDepth,
      nodeIds: [],
      edgeIds: [],
      boundaryNodeIds: [],
    };
  }

  const distances = new Map([[normalizedRootNodeId, 0]]);
  let frontier = new Set([normalizedRootNodeId]);
  for (let hop = 1; hop <= normalizedDepth && frontier.size; hop += 1) {
    const next = new Set();
    for (const edge of edges) {
      if (frontier.has(edge.source) && !distances.has(edge.target)) next.add(edge.target);
      if (frontier.has(edge.target) && !distances.has(edge.source)) next.add(edge.source);
    }
    for (const nodeId of next) distances.set(nodeId, hop);
    frontier = next;
  }

  const nodeIds = nodes.map((node) => node.id).filter((id) => distances.has(id));
  const nodeIdSet = new Set(nodeIds);
  return {
    rootNodeId: normalizedRootNodeId,
    depth: normalizedDepth,
    nodeIds,
    edgeIds: edges
      .filter((edge) => nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target))
      .map((edge) => edge.id),
    boundaryNodeIds: nodeIds.filter((id) => distances.get(id) === normalizedDepth),
  };
}

export function createRelationshipGraphSavedView(input) {
  const createdAt = input.createdAt || new Date().toISOString();
  const label = String(input.label || "Saved graph view").trim() || "Saved graph view";
  return {
    id:
      input.id ||
      stableFingerprint(`${label}:${createdAt}:${JSON.stringify(input.state || {})}`, "graph-view"),
    label,
    createdAt,
    updatedAt: input.updatedAt || createdAt,
    state: {
      scope: input.state?.scope === "relationship" ? "relationship" : "portfolio",
      relationshipId: input.state?.relationshipId || undefined,
      query: String(input.state?.query || ""),
      layout: ["force", "radial", "timeline"].includes(input.state?.layout)
        ? input.state.layout
        : "force",
      density: Math.max(0.25, Math.min(1, Number(input.state?.density) || 1)),
      hideIsolated: Boolean(input.state?.hideIsolated),
      selectedNodeId: input.state?.selectedNodeId || undefined,
      focusDepth: Math.max(0, Math.min(2, Math.trunc(Number(input.state?.focusDepth) || 0))),
      asOf: input.state?.asOf || undefined,
      changedSinceReview: Boolean(input.state?.changedSinceReview),
    },
  };
}

export const RELATIONSHIP_DIMENSION_LABELS = {
  lifecycle: "Lifecycle",
  engagement: "Engagement",
  sentiment: "Sentiment",
  health: "Health",
  summary: "Summary",
  next_action: "Next action",
  risk: "Risk",
  milestone: "Milestone",
};

export const COMPLETENESS_LABELS = {
  complete: "Evidence current",
  partial: "Partial evidence",
  stale: "Evidence stale",
  rebuilding: "Sources rebuilding",
  ambiguous: "Identity review required",
  disconnected: "Source disconnected",
};

export const AUTHORITY_LABELS = {
  user_correction: "Confirmed by a person",
  source_fact: "Source fact",
  deterministic: "Deterministic rule",
  ai_inference: "AI inference",
};

export function relationshipLabel(value) {
  return (value || "unknown")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function completenessTone(status) {
  if (status === "complete") return "safe";
  if (status === "partial" || status === "rebuilding") return "caution";
  return "blocked";
}

function stableFingerprint(value, prefix = "import") {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${prefix}-${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function transcriptSegments(transcript) {
  let cursor = 0;
  return transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const colonIndex = line.indexOf(":");
      const separator = line[colonIndex + 1];
      const attributed =
        colonIndex > 0 &&
        colonIndex <= 80 &&
        (separator === " " || separator === "\t") &&
        line.slice(colonIndex + 1).trim().length > 0;
      const speakerLabel = attributed ? line.slice(0, colonIndex).trim() : "Unknown speaker";
      const text = attributed ? line.slice(colonIndex + 1).trim() : line;
      const duration = Math.max(1_000, Math.min(30_000, text.length * 55));
      const segment = {
        id: `segment-${index + 1}`,
        speakerId: `imported-speaker-${stableFingerprint(speakerLabel.toLowerCase())}`,
        speakerLabel,
        speakerConfidence: attributed ? 0.9 : 0.5,
        startMs: cursor,
        endMs: cursor + duration,
        text,
      };
      cursor += duration;
      return segment;
    });
}

/** Build reviewable, append-only evidence from a user-supplied transcript. */
export function buildImportedTranscriptObservation({
  relationshipId,
  title,
  transcript,
  occurredAt,
  sourceRecordId,
  participantDisclosure = "confirmed_by_importer",
}) {
  const normalizedTranscript = String(transcript || "").trim();
  if (!relationshipId || !normalizedTranscript) {
    throw new Error("relationshipId and transcript are required");
  }
  const timestamp = new Date(occurredAt || Date.now()).toISOString();
  const normalizedTitle = String(title || "Imported conversation").trim();
  const segments = transcriptSegments(normalizedTranscript);
  const fingerprint = stableFingerprint(
    JSON.stringify({ relationshipId, normalizedTitle, normalizedTranscript, timestamp }),
  );
  const recordId = String(sourceRecordId || `${timestamp}:${fingerprint}`);
  const envelope = {
    schemaVersion: 1,
    provider: "upload",
    sourceRecordId: recordId,
    fingerprint,
    title: normalizedTitle,
    occurredAt: timestamp,
    participants: [],
    segments,
    captureCaveats: [
      "Transcript text was imported by a user; Oppulence did not verify the original audio.",
    ],
    governance: {
      receiptId: `governance:${fingerprint}`,
      capturedAt: timestamp,
      capturePolicy: "manual_transcript_import",
      routing: "reviewed_import_to_oppulence",
      region: "client",
      retention: "workspace_policy",
      participantDisclosure,
      legalHold: false,
      deletionOutcome: "managed_by_workspace_policy",
      evidenceClip: "not_retained",
    },
  };
  return {
    relationshipId,
    source: "meeting",
    sourceAccountId: "upload",
    externalId: `upload:${recordId}`,
    sourceVersion: fingerprint,
    eventType: "conversation_evidence_compiled",
    occurredAt: timestamp,
    summary: `${normalizedTitle} · ${segments.length} imported segment${segments.length === 1 ? "" : "s"}`,
    normalizedFacts: {
      provider: "upload",
      dedupe_fingerprint: fingerprint,
      canonical_transcript: {
        schema_version: 1,
        source_record_id: recordId,
        segment_count: segments.length,
      },
      conversation_claims: [],
      action_pack: [],
      governance_receipt: envelope.governance,
    },
    payload: { envelope },
    assertions: [],
  };
}
