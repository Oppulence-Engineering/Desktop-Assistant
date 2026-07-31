import type {
  RecommendationEvaluation,
  RecommendationFactor,
} from "@x/shared/dist/relationships.js";
import { conversationFingerprint } from "./conversation-utils.js";

export interface RecommendationRankContext {
  lifecycle?: string;
  commitmentDueState?: "none" | "upcoming" | "due" | "overdue";
  sourceCompleteness: number;
  recencyHours?: number;
  preferredChannel?: boolean;
  userSamples: number;
  workspaceSamples: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Bounded, inspectable contextual ranker; authority and policy are not inputs. */
export function rankRecommendation(args: {
  recommendationId: string;
  baselineScore: number;
  context: RecommendationRankContext;
  evaluatedAt: string;
}): RecommendationEvaluation {
  const factors: RecommendationFactor[] = [];
  const add = (
    factor: string,
    value: string | number | boolean,
    contribution: number,
    reason: string,
  ) => factors.push({ factor, value, contribution: clamp(contribution, -20, 20), reason });

  if (args.context.commitmentDueState === "overdue")
    add("commitment_due_state", "overdue", 12, "An accepted commitment is overdue.");
  else if (args.context.commitmentDueState === "due")
    add("commitment_due_state", "due", 7, "An accepted commitment is due now.");
  add(
    "source_completeness",
    args.context.sourceCompleteness,
    Math.round((clamp(args.context.sourceCompleteness, 0, 1) - 0.5) * 10),
    "More complete fresh evidence increases confidence in ordering.",
  );
  if (args.context.recencyHours !== undefined)
    add(
      "recency",
      args.context.recencyHours,
      args.context.recencyHours <= 24 ? 5 : args.context.recencyHours >= 168 ? -5 : 0,
      "Recent evidence is more actionable than stale evidence.",
    );
  if (args.context.preferredChannel)
    add("preferred_channel", true, 3, "The user has repeatedly retained this channel.");

  const sampleScope =
    args.context.userSamples >= 50
      ? "user"
      : args.context.workspaceSamples >= 100
        ? "workspace"
        : "cold_start";
  if (sampleScope === "cold_start") {
    for (const factor of factors) factor.contribution = Math.trunc(factor.contribution / 2);
  }
  const finalScore = clamp(
    args.baselineScore + factors.reduce((sum, factor) => sum + factor.contribution, 0),
    0,
    100,
  );
  return {
    evaluationId: `rank:${conversationFingerprint(
      `${args.recommendationId}:${args.evaluatedAt}:contextual-v1`,
    )}`,
    recommendationId: args.recommendationId,
    rankerVersion: "contextual-v1",
    baselineScore: clamp(args.baselineScore, 0, 100),
    finalScore,
    factors,
    evaluatedAt: args.evaluatedAt,
    sampleScope,
  };
}
