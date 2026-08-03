import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  AUTHORITY_LABELS,
  COMPLETENESS_LABELS,
  MISSION_CONTROL_QUESTIONS,
  RELATIONSHIP_CLIENT_CAPABILITIES,
  RELATIONSHIP_GRAPH_CONTRACT_VERSION,
  buildImportedTranscriptObservation,
  completenessTone,
  createRelationshipGraphSavedView,
  parseRelationshipGraphQuery,
  queryRelationshipGraph,
  relationshipGraphNeighborhood,
  relationshipLabel,
} from "./index.js";

test("web and desktop share the four trust questions in one stable order", () => {
  assert.deepEqual(
    MISSION_CONTROL_QUESTIONS.map(({ key }) => key),
    ["state", "change", "evidence", "action"],
  );
  assert.equal(new Set(MISSION_CONTROL_QUESTIONS.map(({ key }) => key)).size, 4);
});

test("completeness never renders an unsafe state with the safe tone", () => {
  assert.equal(completenessTone("complete"), "safe");
  for (const status of ["partial", "stale", "rebuilding", "ambiguous", "disconnected"]) {
    assert.notEqual(completenessTone(status), "safe", status);
    assert.ok(COMPLETENESS_LABELS[status], status);
  }
});

test("authority and dimension labels remain human-readable", () => {
  assert.equal(AUTHORITY_LABELS.user_correction, "Confirmed by a person");
  assert.equal(AUTHORITY_LABELS.ai_inference, "AI inference");
  assert.equal(relationshipLabel("next_action"), "Next Action");
  assert.equal(relationshipLabel(), "Unknown");
});

test("the cross-client capability contract has no duplicates", () => {
  assert.equal(
    new Set(RELATIONSHIP_CLIENT_CAPABILITIES).size,
    RELATIONSHIP_CLIENT_CAPABILITIES.length,
  );
  assert.ok(RELATIONSHIP_CLIENT_CAPABILITIES.includes("assertion-retraction"));
  assert.ok(RELATIONSHIP_CLIENT_CAPABILITIES.includes("action-audit"));
  assert.ok(RELATIONSHIP_CLIENT_CAPABILITIES.includes("transcript-publication"));
  assert.ok(RELATIONSHIP_CLIENT_CAPABILITIES.includes("relationship-graph"));
  assert.ok(RELATIONSHIP_CLIENT_CAPABILITIES.includes("graph-governed-actions"));
});

test("natural-language graph queries stay deterministic and evidence-linked", () => {
  const graph = {
    contractVersion: RELATIONSHIP_GRAPH_CONTRACT_VERSION,
    asOf: "2026-08-01T12:00:00.000Z",
    nodes: [
      {
        id: "relationship:r-1",
        kind: "relationship",
        label: "Northstar Labs",
        lifecycle: "renewal",
        health: "needs_attention",
        changedSinceReview: true,
      },
      {
        id: "commitment:c-1",
        kind: "commitment",
        label: "Security review",
        relationshipId: "r-1",
        status: "open",
        dueAt: "2026-07-15T12:00:00.000Z",
        evidenceRefs: ["observation:o-1"],
      },
      {
        id: "commitment:c-2",
        kind: "commitment",
        label: "Renewal approval",
        relationshipId: "r-1",
        status: "open",
      },
      {
        id: "relationship:r-2",
        kind: "relationship",
        label: "Atlas Retail",
        lifecycle: "onboarding",
        health: "healthy",
      },
    ],
    edges: [
      {
        id: "edge:r-1:c-1",
        source: "relationship:r-1",
        target: "commitment:c-1",
        kind: "has_commitment",
      },
      {
        id: "edge:c-2:c-1",
        source: "commitment:c-2",
        target: "commitment:c-1",
        kind: "requires",
        evidenceRefs: ["observation:o-2"],
      },
    ],
  };
  const parsed = parseRelationshipGraphQuery("Which renewals depend on overdue commitments?");
  assert.deepEqual(parsed.filters.lifecycle, ["renewal"]);
  assert.equal(parsed.filters.overdue, true);
  assert.deepEqual(parsed.filters.edgeKinds, ["requires"]);
  const result = queryRelationshipGraph(graph, parsed.raw);
  assert.deepEqual(result.relationshipIds, ["r-1"]);
  assert.ok(result.matchedNodeIds.includes("relationship:r-1"));
  assert.ok(result.evidenceRefs.includes("observation:o-1"));
  assert.ok(result.evidenceRefs.includes("observation:o-2"));
  assert.deepEqual(result.matchedEdgeIds, ["edge:c-2:c-1"]);
  assert.match(result.answer, /1 relationship matches/);

  const withoutDependency = queryRelationshipGraph(
    { ...graph, edges: graph.edges.filter((edge) => edge.kind !== "requires") },
    parsed.raw,
  );
  assert.deepEqual(withoutDependency.relationshipIds, []);
  assert.deepEqual(withoutDependency.matchedNodeIds, []);
  assert.deepEqual(withoutDependency.visibleNodeIds, []);
  assert.match(withoutDependency.answer, /0 relationships match/);
});

test("saved graph views normalize shareable state", () => {
  const view = createRelationshipGraphSavedView({
    label: "Renewal risks",
    createdAt: "2026-08-01T12:00:00.000Z",
    state: { scope: "portfolio", query: "critical renewals", density: 4, layout: "radial" },
  });
  assert.equal(view.label, "Renewal risks");
  assert.equal(view.state.density, 1);
  assert.equal(view.state.layout, "radial");
  assert.equal(view.state.focusDepth, 0);
  assert.match(view.id, /^graph-view-/);
});

test("graph neighborhoods are deterministic induced subgraphs", () => {
  const graph = {
    nodes: ["a", "b", "c", "d"].map((id) => ({ id, kind: "note", label: id })),
    edges: [
      { id: "a-b", source: "a", target: "b", kind: "linked_note" },
      { id: "b-c", source: "b", target: "c", kind: "linked_note" },
      { id: "a-c", source: "a", target: "c", kind: "linked_note" },
      { id: "c-d", source: "c", target: "d", kind: "linked_note" },
    ],
  };

  assert.deepEqual(relationshipGraphNeighborhood(graph, "b", 1), {
    rootNodeId: "b",
    depth: 1,
    nodeIds: ["a", "b", "c"],
    edgeIds: ["a-b", "b-c", "a-c"],
    boundaryNodeIds: ["a", "c"],
  });
  assert.deepEqual(relationshipGraphNeighborhood(graph, "missing", 2).nodeIds, []);
  assert.equal(relationshipGraphNeighborhood(graph, "b", 99).depth, 3);
});

test("saved graph views preserve a bounded neighborhood focus", () => {
  assert.equal(createRelationshipGraphSavedView({ state: { focusDepth: 2 } }).state.focusDepth, 2);
  assert.equal(createRelationshipGraphSavedView({ state: { focusDepth: 8 } }).state.focusDepth, 2);
});

test("every contracted capability has an explicit surface in web and desktop", () => {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const clientSources = {
    web: [
      "apps/rowboat-www/components/revenue/relationships-view.tsx",
      "apps/rowboat-www/components/revenue/audit-sheet.tsx",
    ],
    desktop: ["apps/x/apps/renderer/src/components/relationships-view.tsx"],
  };

  for (const [client, paths] of Object.entries(clientSources)) {
    const exposed = new Set();
    for (const path of paths) {
      const source = readFileSync(resolve(repositoryRoot, path), "utf8");
      for (const match of source.matchAll(/data-capability="([^"]+)"/g)) {
        for (const capability of match[1].split(/\s+/)) exposed.add(capability);
      }
    }
    assert.deepEqual(
      RELATIONSHIP_CLIENT_CAPABILITIES.filter((capability) => !exposed.has(capability)),
      [],
      `${client} is missing a user-facing relationship capability`,
    );
  }
});

test("an imported transcript becomes deterministic, reviewable relationship evidence", () => {
  const input = {
    relationshipId: "relationship-1",
    title: "Renewal call",
    transcript: "Avery: We can renew next week.\nYou: I will send the paperwork.",
    occurredAt: "2026-08-01T14:00:00.000Z",
    sourceRecordId: "upload-1",
  };
  const first = buildImportedTranscriptObservation(input);
  const second = buildImportedTranscriptObservation(input);
  assert.deepEqual(first, second);
  assert.equal(first.source, "meeting");
  assert.equal(first.externalId, "upload:upload-1");
  assert.equal(first.payload.envelope.segments.length, 2);
  assert.equal(first.payload.envelope.governance.participantDisclosure, "confirmed_by_importer");
  assert.equal(first.normalizedFacts.action_pack.length, 0);
  assert.deepEqual(first.assertions, []);
});

test("an empty imported transcript is rejected before publication", () => {
  assert.throws(
    () => buildImportedTranscriptObservation({ relationshipId: "relationship-1", transcript: " " }),
    /transcript are required/,
  );
});

test("an imported transcript retry keeps the same idempotency identity", () => {
  const input = {
    relationshipId: "relationship-1",
    transcript: "Avery: Same reviewed evidence.",
    occurredAt: "2026-08-01T14:00:00.000Z",
  };
  assert.equal(
    buildImportedTranscriptObservation(input).externalId,
    buildImportedTranscriptObservation(input).externalId,
  );
});

test("speaker parsing stays bounded for adversarial whitespace", () => {
  const observation = buildImportedTranscriptObservation({
    relationshipId: "relationship-1",
    transcript: `9:\t${"\t".repeat(10_000)}reviewed evidence`,
    occurredAt: "2026-08-01T14:00:00.000Z",
  });
  assert.equal(observation.payload.envelope.segments[0].speakerLabel, "9");
  assert.equal(observation.payload.envelope.segments[0].text, "reviewed evidence");
});
