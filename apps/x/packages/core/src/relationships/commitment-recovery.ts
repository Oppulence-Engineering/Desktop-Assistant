import type {
  CommitmentProjection,
  CommitmentRecoveryClassification,
  CommitmentRecoveryEvaluation,
} from "@x/shared/dist/relationships.js";
import { conversationFingerprint } from "./conversation-utils.js";

export interface CommitmentRecoveryEvidence {
  evidenceRef: string;
  source: string;
  fresh: boolean;
  kind:
    | "explicit_fulfilled"
    | "likely_fulfilled"
    | "superseded"
    | "blocked"
    | "renegotiated"
    | "no_match";
  occurredAt: string;
}

function classification(
  commitment: CommitmentProjection,
  evidence: CommitmentRecoveryEvidence[],
  now: string,
): CommitmentRecoveryClassification {
  const fresh = evidence.filter((item) => item.fresh);
  if (fresh.some((item) => item.kind === "explicit_fulfilled")) return "fulfilled";
  if (fresh.some((item) => item.kind === "superseded")) return "superseded";
  if (fresh.some((item) => item.kind === "renegotiated")) return "renegotiated";
  if (fresh.some((item) => item.kind === "blocked")) return "blocked";
  if (fresh.some((item) => item.kind === "likely_fulfilled")) return "likely_fulfilled";
  if (evidence.some((item) => !item.fresh)) return "unknown_stale_sources";
  const overdue = commitment.dueAt ? Date.parse(commitment.dueAt) < Date.parse(now) : false;
  return overdue ? "forgotten" : "unknown_stale_sources";
}

/** Reconcile fresh evidence before proposing state or an approval-gated action. */
export function evaluateCommitmentRecovery(args: {
  commitment: CommitmentProjection;
  evidence: CommitmentRecoveryEvidence[];
  requiredSources: string[];
  recoveryWindow: string;
  evaluatedAt: string;
  reconcilerVersion?: string;
}): CommitmentRecoveryEvaluation {
  const seenFresh = new Set(args.evidence.filter((item) => item.fresh).map((item) => item.source));
  const staleSources = args.requiredSources.filter((source) => !seenFresh.has(source));
  const result = classification(args.commitment, args.evidence, args.evaluatedAt);
  const deterministicClosure = result === "fulfilled" && staleSources.length === 0;
  const proposedActionType =
    result === "forgotten"
      ? "reminder"
      : result === "blocked"
        ? "escalation"
        : result === "renegotiated"
          ? "renegotiation"
          : result === "unknown_stale_sources"
            ? "internal_task"
            : undefined;
  const reconcilerVersion = args.reconcilerVersion ?? "commitment-recovery-v1";
  return {
    evaluationId: `recovery:${conversationFingerprint(
      `${args.commitment.commitmentId}:${args.commitment.version}:${args.recoveryWindow}:${reconcilerVersion}`,
    )}`,
    commitmentId: args.commitment.commitmentId,
    commitmentVersion: args.commitment.version,
    recoveryWindow: args.recoveryWindow,
    reconcilerVersion,
    classification:
      staleSources.length > 0 && !deterministicClosure ? "unknown_stale_sources" : result,
    evidenceRefs: [...new Set(args.evidence.map((item) => item.evidenceRef))],
    staleSources,
    requiresReview: !deterministicClosure,
    ...(proposedActionType ? { proposedActionType } : {}),
    explanation:
      staleSources.length > 0
        ? `Evidence is incomplete; stale sources: ${staleSources.join(", ")}.`
        : deterministicClosure
          ? "Fresh explicit source evidence proves fulfillment."
          : `Fresh evidence suggests ${result}; human review is required.`,
    evaluatedAt: args.evaluatedAt,
  };
}
