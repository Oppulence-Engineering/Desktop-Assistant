import type {
  CommitmentProjection,
  MutualActionPlan,
  MutualActionPlanItem,
  MutualActionPlanRevision,
} from "@x/shared/relationships";
import { conversationFingerprint } from "./conversation-utils.js";

function revision(args: {
  planId: string;
  version: number;
  items: MutualActionPlanItem[];
  createdAt: string;
  createdBy: string;
}): MutualActionPlanRevision {
  const itemIds = new Set(args.items.map((item) => item.itemId));
  for (const item of args.items) {
    if (!item.commitmentId && !item.milestoneRef) {
      throw new Error("plan items must derive from an accepted commitment or milestone");
    }
    for (const dependency of item.dependencyItemIds) {
      if (!itemIds.has(dependency) || dependency === item.itemId) {
        throw new Error("invalid mutual action plan dependency");
      }
    }
  }
  const payload = JSON.stringify(
    args.items.map((item) => ({ ...item, dependencyItemIds: [...item.dependencyItemIds].sort() })),
  );
  return {
    revisionId: `plan-revision:${conversationFingerprint(`${args.planId}:${args.version}:${payload}`)}`,
    planId: args.planId,
    version: args.version,
    revisionHash: `sha256:${conversationFingerprint(payload)}`,
    createdAt: args.createdAt,
    createdBy: args.createdBy,
    items: args.items,
  };
}

export function createMutualActionPlan(args: {
  relationshipId: string;
  internalOwnerRef: string;
  counterpartyRef: string;
  commitments: CommitmentProjection[];
  createdAt: string;
  createdBy: string;
}): MutualActionPlan {
  const eligible = args.commitments.filter(
    (commitment) =>
      ["accepted", "open", "blocked", "renegotiated"].includes(commitment.state) &&
      commitment.action &&
      commitment.ownerParticipantRef &&
      commitment.evidenceRefs.length > 0,
  );
  if (eligible.length === 0)
    throw new Error("a plan requires accepted evidence-backed commitments");
  const planId = `plan:${conversationFingerprint(
    `${args.relationshipId}:${args.counterpartyRef}:${eligible.map((item) => item.commitmentId).join(":")}`,
  )}`;
  const items: MutualActionPlanItem[] = eligible.map((commitment) => ({
    itemId: `plan-item:${conversationFingerprint(`${planId}:${commitment.commitmentId}`)}`,
    commitmentId: commitment.commitmentId,
    title: commitment.action!,
    ownerParticipantRef: commitment.ownerParticipantRef!,
    dependencyItemIds: [],
    ...(commitment.dueAt ? { dueAt: commitment.dueAt } : {}),
    status: commitment.state === "blocked" ? "blocked" : "open",
    evidenceRefs: commitment.evidenceRefs,
  }));
  return {
    planId,
    relationshipId: args.relationshipId,
    internalOwnerRef: args.internalOwnerRef,
    counterpartyRef: args.counterpartyRef,
    status: "draft",
    currentRevision: revision({
      planId,
      version: 1,
      items,
      createdAt: args.createdAt,
      createdBy: args.createdBy,
    }),
    tokenState: "not_issued",
  };
}

export function reviseMutualActionPlan(args: {
  plan: MutualActionPlan;
  items: MutualActionPlanItem[];
  createdAt: string;
  createdBy: string;
}): MutualActionPlan {
  if (["completed", "cancelled"].includes(args.plan.status)) {
    throw new Error("terminal plans cannot be revised");
  }
  return {
    ...args.plan,
    status: "revised",
    tokenState: args.plan.tokenState === "active" ? "revoked" : args.plan.tokenState,
    currentRevision: revision({
      planId: args.plan.planId,
      version: args.plan.currentRevision.version + 1,
      items: args.items,
      createdAt: args.createdAt,
      createdBy: args.createdBy,
    }),
  };
}

export interface PlanShareGrant {
  planId: string;
  revisionHash: string;
  tokenHash: string;
  allowedOperations: Array<"confirm" | "correct" | "block" | "complete" | "comment">;
  expiresAt: string;
  revoked: boolean;
}

export function createPlanShareGrant(args: {
  plan: MutualActionPlan;
  rawToken: string;
  expiresAt: string;
}): PlanShareGrant {
  if (args.plan.status !== "internally_approved") {
    throw new Error("only an internally approved plan revision may be shared");
  }
  if (Date.parse(args.expiresAt) <= Date.now())
    throw new Error("plan token must expire in the future");
  return {
    planId: args.plan.planId,
    revisionHash: args.plan.currentRevision.revisionHash,
    tokenHash: `sha256:${conversationFingerprint(args.rawToken)}`,
    allowedOperations: ["confirm", "correct", "block", "complete", "comment"],
    expiresAt: args.expiresAt,
    revoked: false,
  };
}
