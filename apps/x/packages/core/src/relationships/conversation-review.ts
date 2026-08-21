import type {
  ConversationClaimCandidate,
  ConversationNormalizedValue,
  ConversationReviewBatch,
  ConversationReviewBatchItem,
  ConversationReviewDecision,
  ConversationReviewDecisionKind,
} from "@x/shared/relationships";
import { ConversationNormalizedValueSchema } from "@x/shared/relationships";
import { conversationFingerprint } from "./conversation-utils.js";

export class StaleConversationReviewError extends Error {
  constructor(
    readonly baselineVersion: number,
    readonly currentVersion: number,
    readonly currentState: Record<string, unknown>,
  ) {
    super("conversation review baseline is stale");
  }
}

export function createConversationReviewBatch(args: {
  relationshipId: string;
  observationId: string;
  baselineSnapshotId: string;
  baselineVersion: number;
  baselineState: Record<string, unknown>;
  extractorVersion: string;
  candidates: ConversationClaimCandidate[];
  dependentActionIds?: ReadonlyMap<string, string[]>;
  createdAt: string;
}): ConversationReviewBatch {
  const batchId = `review:${conversationFingerprint(
    `${args.observationId}:${args.extractorVersion}`,
  )}`;
  return {
    batchId,
    relationshipId: args.relationshipId,
    observationId: args.observationId,
    extractorVersion: args.extractorVersion,
    baselineSnapshotId: args.baselineSnapshotId,
    baselineVersion: args.baselineVersion,
    status: args.candidates.length === 0 ? "decided" : "pending",
    createdAt: args.createdAt,
    items: args.candidates.map((candidate) => ({
      itemId: `review-item:${conversationFingerprint(`${batchId}:${candidate.candidateId}`)}`,
      candidate,
      status: "pending_review",
      ...(candidate.stateDimension && candidate.stateDimension in args.baselineState
        ? { before: args.baselineState[candidate.stateDimension] }
        : {}),
      proposedAfter: candidate.normalizedValue,
      dependentActionIds: args.dependentActionIds?.get(candidate.candidateId) ?? [],
    })),
  };
}

function ensureReplacement(
  candidate: ConversationClaimCandidate,
  replacement: ConversationNormalizedValue | undefined,
): ConversationNormalizedValue {
  const parsed = ConversationNormalizedValueSchema.safeParse(replacement);
  if (!parsed.success || parsed.data.kind !== candidate.kind) {
    throw new Error("a correction requires a valid replacement of the same claim kind");
  }
  return parsed.data;
}

export interface DecideConversationReviewResult {
  batch: ConversationReviewBatch;
  decision: ConversationReviewDecision;
  authorityEffect:
    | { type: "none" }
    | { type: "ai_inference"; value: ConversationNormalizedValue }
    | { type: "user_correction"; value: ConversationNormalizedValue }
    | { type: "commitment_event"; value: ConversationNormalizedValue };
}

/** Apply one immutable review decision with stale-baseline and idempotency protection. */
export function decideConversationReviewItem(args: {
  batch: ConversationReviewBatch;
  itemId: string;
  kind: ConversationReviewDecisionKind;
  actorId: string;
  reason?: string;
  replacementValue?: ConversationNormalizedValue;
  deferUntil?: string;
  currentVersion: number;
  currentState: Record<string, unknown>;
  decidedAt: string;
  existingDecisions?: ConversationReviewDecision[];
}): DecideConversationReviewResult {
  const item = args.batch.items.find((candidate) => candidate.itemId === args.itemId);
  if (!item) throw new Error("review item not found");
  const decisionId = `review-decision:${conversationFingerprint(
    `${args.batch.batchId}:${args.itemId}:${args.kind}:${args.actorId}`,
  )}`;
  const existing = args.existingDecisions?.find((decision) => decision.decisionId === decisionId);
  if (existing) {
    return { batch: args.batch, decision: existing, authorityEffect: { type: "none" } };
  }
  if (item.status !== "pending_review" && item.status !== "deferred") {
    throw new Error("review item already has a terminal decision");
  }
  if (args.currentVersion !== args.batch.baselineVersion) {
    throw new StaleConversationReviewError(
      args.batch.baselineVersion,
      args.currentVersion,
      args.currentState,
    );
  }
  if (
    args.kind === "defer" &&
    (!args.deferUntil || Date.parse(args.deferUntil) <= Date.parse(args.decidedAt))
  ) {
    throw new Error("defer requires a future reminder time");
  }

  const value =
    args.kind === "correct"
      ? ensureReplacement(item.candidate, args.replacementValue)
      : item.candidate.normalizedValue;
  const nextStatus: ConversationReviewBatchItem["status"] =
    args.kind === "approve"
      ? "accepted"
      : args.kind === "correct"
        ? "corrected"
        : args.kind === "reject"
          ? "rejected"
          : "deferred";
  const items: ConversationReviewBatchItem[] = args.batch.items.map((candidate) =>
    candidate.itemId === args.itemId
      ? { ...candidate, status: nextStatus, proposedAfter: value }
      : candidate,
  );
  const terminal = items.filter(
    (candidate) => candidate.status !== "pending_review" && candidate.status !== "deferred",
  ).length;
  const batch: ConversationReviewBatch = {
    ...args.batch,
    items,
    status: terminal === items.length ? "decided" : terminal > 0 ? "partially_decided" : "pending",
  };
  const invalidatedActionIds =
    args.kind === "reject" || args.kind === "correct" ? item.dependentActionIds : [];
  const decision: ConversationReviewDecision = {
    decisionId,
    batchId: args.batch.batchId,
    itemId: args.itemId,
    kind: args.kind,
    actorId: args.actorId,
    ...(args.reason ? { reason: args.reason } : {}),
    ...(args.kind === "correct" ? { replacementValue: value } : {}),
    ...(args.deferUntil ? { deferUntil: args.deferUntil } : {}),
    baselineVersion: args.batch.baselineVersion,
    decidedAt: args.decidedAt,
    invalidatedActionIds,
  };
  const authorityEffect: DecideConversationReviewResult["authorityEffect"] =
    args.kind === "reject" || args.kind === "defer"
      ? { type: "none" }
      : item.candidate.kind === "commitment"
        ? { type: "commitment_event", value }
        : args.kind === "correct"
          ? { type: "user_correction", value }
          : { type: "ai_inference", value };
  return { batch, decision, authorityEffect };
}
