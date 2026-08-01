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
  buildImportedTranscriptObservation,
  completenessTone,
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
