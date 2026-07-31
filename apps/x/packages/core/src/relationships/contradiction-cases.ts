import type { ContradictionCase, ContradictionEvidenceSide } from "@x/shared/dist/relationships.js";
import { conversationFingerprint } from "./conversation-utils.js";

const AUTHORITY: Record<ContradictionEvidenceSide["sourceType"], number> = {
  user_correction: 4,
  source_fact: 3,
  deterministic: 2,
  ai_inference: 1,
};

function canonicalValue(side: ContradictionEvidenceSide): string {
  const value = side.value;
  switch (value.kind) {
    case "enum":
      return `enum:${value.value.trim().toLowerCase()}`;
    case "date":
      return `date:${new Date(value.value).toISOString()}`;
    case "money":
      return `money:${value.currency.toUpperCase()}:${value.amountMinor}`;
    case "participant":
      return `participant:${value.participantRef}:${value.role.trim().toLowerCase()}`;
    case "sentiment":
      return `sentiment:${value.value}`;
  }
}

function overlaps(left: ContradictionEvidenceSide, right: ContradictionEvidenceSide): boolean {
  const leftStart = Date.parse(left.validFrom);
  const rightStart = Date.parse(right.validFrom);
  const leftEnd = left.validTo ? Date.parse(left.validTo) : Number.POSITIVE_INFINITY;
  const rightEnd = right.validTo ? Date.parse(right.validTo) : Number.POSITIVE_INFINITY;
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

/** Return no case for equivalent values or legitimate non-overlapping state changes. */
export function detectContradictionCase(args: {
  relationshipId: string;
  subjectRef: string;
  dimension: string;
  left: ContradictionEvidenceSide;
  right: ContradictionEvidenceSide;
  openedAt: string;
}): ContradictionCase | null {
  if (!overlaps(args.left, args.right)) return null;
  if (canonicalValue(args.left) === canonicalValue(args.right)) return null;
  const authorityDifference = AUTHORITY[args.left.sourceType] - AUTHORITY[args.right.sourceType];
  const decisive = authorityDifference !== 0;
  const ids = [args.left.assertionId, args.right.assertionId].sort();
  return {
    caseId: `contradiction:${conversationFingerprint(
      `${args.relationshipId}:${args.subjectRef}:${args.dimension}:${ids.join(":")}`,
    )}`,
    relationshipId: args.relationshipId,
    subjectRef: args.subjectRef,
    dimension: args.dimension,
    status: decisive ? "auto_resolved_by_authority" : "open",
    reason: decisive
      ? `${authorityDifference > 0 ? args.left.sourceType : args.right.sourceType} has deterministic authority`
      : "equally authoritative evidence overlaps with different typed values",
    sides: [args.left, args.right],
    openedAt: args.openedAt,
    ...(decisive ? { resolvedAt: args.openedAt } : {}),
  };
}

export function resolveContradictionCase(args: {
  contradiction: ContradictionCase;
  selectedAssertionId: string;
  resolutionAssertionId: string;
  resolvedAt: string;
}): ContradictionCase {
  if (!args.contradiction.sides.some((side) => side.assertionId === args.selectedAssertionId)) {
    throw new Error("contradiction resolution must select one of the case sides");
  }
  if (!args.contradiction.sides.every((side) => side.evidenceRefs.length > 0)) {
    throw new Error("contradiction resolution requires evidence for every side");
  }
  return {
    ...args.contradiction,
    status: "user_resolved",
    resolvedAt: args.resolvedAt,
    resolutionAssertionId: args.resolutionAssertionId,
    reason: `user selected assertion ${args.selectedAssertionId}`,
  };
}
