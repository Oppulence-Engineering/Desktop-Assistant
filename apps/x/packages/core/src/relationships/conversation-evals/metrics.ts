import type { ConversationClaimKind } from "@x/shared/relationships";
import type { ConversationEvalReport } from "./runner.js";

const REPORTED_KINDS: ConversationClaimKind[] = [
  "commitment",
  "risk",
  "objection",
  "decision",
  "milestone",
  "stakeholder",
  "lifecycle",
  "sentiment",
];

/** Content-free metrics suitable for CI logs and rollout evidence. */
export function conversationEvaluationSummary(report: ConversationEvalReport) {
  return {
    cases: report.cases,
    overallPrecision: report.overall.precision,
    overallRecall: report.overall.recall,
    unsupportedQuoteRate: report.unsupportedQuoteRate,
    normalizedValueExact: report.normalizedValueExact,
    dateExact: report.dateExact,
    byKind: Object.fromEntries(REPORTED_KINDS.map((kind) => [kind, report.byKind[kind] ?? null])),
  };
}
