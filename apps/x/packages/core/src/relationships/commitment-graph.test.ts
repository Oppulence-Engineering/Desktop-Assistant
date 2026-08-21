import { describe, expect, it } from "vitest";
import type { CommitmentEvent } from "@x/shared/relationships";
import { projectCommitment, validateCommitmentDependencies } from "./commitment-graph.js";

const event = (version: number, kind: CommitmentEvent["kind"]): CommitmentEvent => ({
  eventId: `event-${version}`,
  commitmentId: "commitment-1",
  version,
  kind,
  actorType: kind === "fulfilled" ? "source_fact" : "user",
  occurredAt: `2026-08-0${version}T12:00:00.000Z`,
  evidenceRefs: [`evidence-${version}`],
  ...(kind === "proposed"
    ? {
        ownerParticipantRef: "owner",
        counterpartyParticipantRef: "customer",
        action: "Send the security packet",
        duePhrase: "by Friday",
        dueAt: "2026-08-07T17:00:00.000Z",
        dueTimezone: "America/New_York",
      }
    : {}),
});

describe("bilateral commitment graph", () => {
  it("replays immutable transitions into deterministic current state", () => {
    const projection = projectCommitment([
      event(1, "proposed"),
      event(2, "internally_confirmed"),
      event(3, "offered"),
      event(4, "accepted"),
      event(5, "fulfilled"),
    ]);
    expect(projection).toMatchObject({
      version: 5,
      state: "fulfilled",
      acceptance: "accepted",
      ownerParticipantRef: "owner",
      counterpartyParticipantRef: "customer",
      completedAt: "2026-08-05T12:00:00.000Z",
    });
    expect(projection.evidenceRefs).toHaveLength(5);
  });

  it("rejects invalid closure and dependency cycles", () => {
    expect(() =>
      projectCommitment([
        event(1, "proposed"),
        { ...event(2, "fulfilled"), actorType: "ai_candidate" },
      ]),
    ).toThrow();
    const rels = new Map([
      ["a", "relationship-1"],
      ["b", "relationship-1"],
    ]);
    expect(() =>
      validateCommitmentDependencies(
        [
          {
            dependencyId: "ab",
            relationshipId: "relationship-1",
            fromCommitmentId: "a",
            toCommitmentId: "b",
            kind: "blocks",
            evidenceRefs: ["e1"],
            createdAt: "2026-07-31T12:00:00.000Z",
          },
          {
            dependencyId: "ba",
            relationshipId: "relationship-1",
            fromCommitmentId: "b",
            toCommitmentId: "a",
            kind: "requires",
            evidenceRefs: ["e2"],
            createdAt: "2026-07-31T12:00:00.000Z",
          },
        ],
        rels,
      ),
    ).toThrow("cycle");
  });
});
