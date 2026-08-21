import { describe, expect, it } from "vitest";
import type { ConversationClaimCandidate } from "@x/shared/relationships";
import {
  createConversationReviewBatch,
  decideConversationReviewItem,
  StaleConversationReviewError,
} from "./conversation-review.js";

const candidate: ConversationClaimCandidate = {
  candidateId: "candidate-1",
  kind: "lifecycle",
  normalizedValue: { kind: "lifecycle", lifecycle: "renewal" },
  displayValue: "renewal",
  evidence: [
    { exactQuote: "We are entering renewal.", segmentIds: ["s1"], startMs: 0, endMs: 1000 },
  ],
  stateDimension: "lifecycle",
  confidence: 0.94,
  caveats: [],
  extractor: {
    extractorVersion: "v1",
    promptVersion: "p1",
    provider: "fixture",
    model: "fixture",
    routing: "deterministic",
    startedAt: "2026-07-31T12:00:00.000Z",
    completedAt: "2026-07-31T12:00:00.000Z",
    durationMs: 0,
  },
};

describe("conversation change review", () => {
  it("pins before/after and emits higher-authority corrections", () => {
    const batch = createConversationReviewBatch({
      relationshipId: "relationship-1",
      observationId: "observation-1",
      baselineSnapshotId: "snapshot-4",
      baselineVersion: 4,
      baselineState: { lifecycle: "evaluation" },
      extractorVersion: "v1",
      candidates: [candidate],
      dependentActionIds: new Map([[candidate.candidateId, ["action-1"]]]),
      createdAt: "2026-07-31T12:00:00.000Z",
    });
    expect(batch.items[0]).toMatchObject({
      before: "evaluation",
      proposedAfter: candidate.normalizedValue,
    });

    const result = decideConversationReviewItem({
      batch,
      itemId: batch.items[0].itemId,
      kind: "correct",
      actorId: "user-1",
      replacementValue: { kind: "lifecycle", lifecycle: "contracting" },
      currentVersion: 4,
      currentState: { lifecycle: "evaluation" },
      decidedAt: "2026-07-31T12:01:00.000Z",
    });
    expect(result.authorityEffect).toEqual({
      type: "user_correction",
      value: { kind: "lifecycle", lifecycle: "contracting" },
    });
    expect(result.decision.invalidatedActionIds).toEqual(["action-1"]);
  });

  it("rejects stale baselines instead of applying last-write-wins", () => {
    const batch = createConversationReviewBatch({
      relationshipId: "relationship-1",
      observationId: "observation-1",
      baselineSnapshotId: "snapshot-4",
      baselineVersion: 4,
      baselineState: {},
      extractorVersion: "v1",
      candidates: [candidate],
      createdAt: "2026-07-31T12:00:00.000Z",
    });
    expect(() =>
      decideConversationReviewItem({
        batch,
        itemId: batch.items[0].itemId,
        kind: "approve",
        actorId: "user-1",
        currentVersion: 5,
        currentState: { lifecycle: "active_customer" },
        decidedAt: "2026-07-31T12:01:00.000Z",
      }),
    ).toThrow(StaleConversationReviewError);
  });
});
