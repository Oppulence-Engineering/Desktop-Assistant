import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORITY_LABELS,
  COMPLETENESS_LABELS,
  MISSION_CONTROL_QUESTIONS,
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
