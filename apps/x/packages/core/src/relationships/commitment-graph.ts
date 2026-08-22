import type {
  CommitmentDependency,
  CommitmentEvent,
  CommitmentEventKind,
  CommitmentProjection,
} from "@x/shared/relationships";
import { CommitmentEventSchema } from "@x/shared/relationships";

const ALLOWED_FROM: Record<CommitmentEventKind, ReadonlySet<CommitmentProjection["state"]>> = {
  proposed: new Set([]),
  internally_confirmed: new Set(["candidate"]),
  offered: new Set(["internally_confirmed"]),
  accepted: new Set(["offered", "internally_confirmed"]),
  disputed: new Set(["offered", "accepted", "open"]),
  blocked: new Set(["accepted", "open", "renegotiated"]),
  unblocked: new Set(["blocked"]),
  due_date_changed: new Set(["internally_confirmed", "offered", "accepted", "open", "blocked"]),
  renegotiated: new Set(["internally_confirmed", "offered", "accepted", "open", "blocked"]),
  fulfilled: new Set(["internally_confirmed", "accepted", "open", "blocked", "renegotiated"]),
  cancelled: new Set([
    "candidate",
    "internally_confirmed",
    "offered",
    "accepted",
    "open",
    "blocked",
    "disputed",
  ]),
  superseded: new Set([
    "candidate",
    "internally_confirmed",
    "offered",
    "accepted",
    "open",
    "blocked",
    "disputed",
  ]),
};

function initialProjection(commitmentId: string): CommitmentProjection {
  return {
    commitmentId,
    version: 0,
    state: "candidate",
    acceptance: "candidate",
    evidenceRefs: [],
  };
}

function nextState(
  current: CommitmentProjection["state"],
  kind: CommitmentEventKind,
): CommitmentProjection["state"] {
  switch (kind) {
    case "proposed":
      return "candidate";
    case "internally_confirmed":
      return "internally_confirmed";
    case "offered":
      return "offered";
    case "accepted":
      return "open";
    case "disputed":
      return "disputed";
    case "blocked":
      return "blocked";
    case "unblocked":
      return "open";
    case "due_date_changed":
      return current;
    case "renegotiated":
      return "renegotiated";
    case "fulfilled":
      return "fulfilled";
    case "cancelled":
      return "cancelled";
    case "superseded":
      return "superseded";
  }
}

/** Replay is the only authority for materialized commitment state. */
export function projectCommitment(events: CommitmentEvent[]): CommitmentProjection {
  if (events.length === 0) throw new Error("a commitment projection requires events");
  const parsed = events.map((event) => CommitmentEventSchema.parse(event));
  const commitmentId = parsed[0].commitmentId;
  let projection = initialProjection(commitmentId);
  const ids = new Set<string>();

  for (const event of parsed) {
    if (event.commitmentId !== commitmentId) throw new Error("mixed commitment event streams");
    if (ids.has(event.eventId)) throw new Error("duplicate commitment event id");
    ids.add(event.eventId);
    if (event.version !== projection.version + 1) throw new Error("non-contiguous event version");
    if (event.version === 1 && event.kind !== "proposed") {
      throw new Error("the first commitment event must be proposed");
    }
    if (event.version > 1 && !ALLOWED_FROM[event.kind].has(projection.state)) {
      throw new Error(`invalid commitment transition ${projection.state} -> ${event.kind}`);
    }
    if (event.kind === "fulfilled" && event.actorType === "ai_candidate") {
      throw new Error("an AI candidate cannot close a commitment");
    }
    if (event.kind === "blocked" && !event.blocker?.trim()) {
      throw new Error("a blocked transition requires a blocker");
    }
    if (event.kind === "due_date_changed" && !event.dueAt) {
      throw new Error("due_date_changed requires a resolved due date");
    }
    if (event.kind === "renegotiated" && !event.dueAt && !event.action) {
      throw new Error("renegotiated requires a changed action or resolved due date");
    }

    const state = nextState(projection.state, event.kind);
    const acceptance =
      event.kind === "internally_confirmed"
        ? "internally_confirmed"
        : event.kind === "offered"
          ? "offered"
          : event.kind === "accepted"
            ? "accepted"
            : event.kind === "disputed"
              ? "disputed"
              : projection.acceptance;
    projection = {
      ...projection,
      version: event.version,
      state,
      acceptance,
      ...(event.ownerParticipantRef ? { ownerParticipantRef: event.ownerParticipantRef } : {}),
      ...(event.counterpartyParticipantRef
        ? { counterpartyParticipantRef: event.counterpartyParticipantRef }
        : {}),
      ...(event.beneficiaryParticipantRef
        ? { beneficiaryParticipantRef: event.beneficiaryParticipantRef }
        : {}),
      ...(event.action ? { action: event.action } : {}),
      ...(event.kind === "proposed" && event.duePhrase
        ? { originalDuePhrase: event.duePhrase }
        : {}),
      ...(event.dueAt ? { dueAt: event.dueAt } : {}),
      ...(event.dueTimezone ? { dueTimezone: event.dueTimezone } : {}),
      blocker: event.kind === "unblocked" ? undefined : (event.blocker ?? projection.blocker),
      ...(event.kind === "fulfilled" ? { completedAt: event.occurredAt } : {}),
      ...(event.sourceObservationId ? { sourceObservationId: event.sourceObservationId } : {}),
      evidenceRefs: [...new Set([...projection.evidenceRefs, ...event.evidenceRefs])],
    };
  }
  return projection;
}

/** Reject cycles and cross-relationship edges before dependency persistence. */
export function validateCommitmentDependencies(
  dependencies: CommitmentDependency[],
  relationshipByCommitment: ReadonlyMap<string, string>,
): void {
  const graph = new Map<string, string[]>();
  for (const dependency of dependencies) {
    if (dependency.fromCommitmentId === dependency.toCommitmentId) {
      throw new Error("a commitment cannot depend on itself");
    }
    const fromRelationship = relationshipByCommitment.get(dependency.fromCommitmentId);
    const toRelationship = relationshipByCommitment.get(dependency.toCommitmentId);
    if (!fromRelationship || fromRelationship !== toRelationship) {
      throw new Error("commitment dependencies must stay within one relationship");
    }
    if (dependency.relationshipId !== fromRelationship) {
      throw new Error("dependency relationship does not match its commitments");
    }
    graph.set(dependency.fromCommitmentId, [
      ...(graph.get(dependency.fromCommitmentId) ?? []),
      dependency.toCommitmentId,
    ]);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error("commitment dependency cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of graph.get(id) ?? []) visit(next);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of graph.keys()) visit(id);
}
