import type { ConversationClaimKind } from "@x/shared/dist/relationships.js";
import { normalizeConversationText } from "../conversation-utils.js";
import type { ConversationEvalCase } from "./fixtures.js";

export interface ConversationEvalPrediction {
  kind: ConversationClaimKind;
  exactQuote: string;
  displayValue: string;
  dueAt?: string;
}

export interface ConversationEvalKindMetrics {
  expected: number;
  predicted: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number;
  recall: number;
}

export interface ConversationEvalReport {
  cases: number;
  overall: ConversationEvalKindMetrics;
  byKind: Partial<Record<ConversationClaimKind, ConversationEvalKindMetrics>>;
  normalizedValueExact: number;
  dateExact: number;
  unsupportedQuoteRate: number;
}

export interface ConversationEvalGates {
  minimumPrecision: Partial<Record<ConversationClaimKind, number>>;
  minimumRecall: Partial<Record<ConversationClaimKind, number>>;
  minimumDateExact: number;
  maximumUnsupportedQuoteRate: number;
}

export const RFC037_CONVERSATION_EVAL_GATES: ConversationEvalGates = {
  minimumPrecision: {
    commitment: 0.93,
    risk: 0.9,
    objection: 0.9,
    decision: 0.88,
    milestone: 0.88,
    stakeholder: 0.88,
  },
  minimumRecall: {
    commitment: 0.8,
    risk: 0.75,
    objection: 0.75,
    decision: 0.75,
    milestone: 0.75,
    stakeholder: 0.75,
  },
  minimumDateExact: 0.9,
  maximumUnsupportedQuoteRate: 0,
};

function metric(
  expected: number,
  predicted: number,
  truePositive: number,
): ConversationEvalKindMetrics {
  const falsePositive = predicted - truePositive;
  const falseNegative = expected - truePositive;
  return {
    expected,
    predicted,
    truePositive,
    falsePositive,
    falseNegative,
    precision: predicted === 0 ? (expected === 0 ? 1 : 0) : truePositive / predicted,
    recall: expected === 0 ? 1 : truePositive / expected,
  };
}

function quoteOccurs(testCase: ConversationEvalCase, quote: string): boolean {
  const transcript = normalizeConversationText(
    testCase.segments.map((item) => item.text).join(" "),
  );
  return transcript.includes(normalizeConversationText(quote));
}

/** Score an extractor without giving it access to the labels. */
export async function runConversationEvaluation(
  cases: ConversationEvalCase[],
  predict: (testCase: ConversationEvalCase) => Promise<ConversationEvalPrediction[]>,
): Promise<ConversationEvalReport> {
  const counts = new Map<
    ConversationClaimKind,
    { expected: number; predicted: number; tp: number }
  >();
  let normalizedCorrect = 0;
  let normalizedTotal = 0;
  let datesCorrect = 0;
  let datesTotal = 0;
  let unsupported = 0;
  let predictionTotal = 0;

  for (const testCase of cases) {
    const predictions = await predict(testCase);
    predictionTotal += predictions.length;
    unsupported += predictions.filter((item) => !quoteOccurs(testCase, item.exactQuote)).length;
    const used = new Set<number>();

    for (const expected of testCase.expected) {
      const count = counts.get(expected.kind) ?? { expected: 0, predicted: 0, tp: 0 };
      count.expected += 1;
      counts.set(expected.kind, count);
      const match = predictions.findIndex(
        (prediction, index) =>
          !used.has(index) &&
          prediction.kind === expected.kind &&
          normalizeConversationText(prediction.exactQuote) ===
            normalizeConversationText(expected.exactQuote),
      );
      if (match < 0) continue;
      used.add(match);
      count.tp += 1;
      normalizedTotal += 1;
      if (
        normalizeConversationText(predictions[match].displayValue) ===
        normalizeConversationText(expected.displayValue)
      ) {
        normalizedCorrect += 1;
      }
      if (expected.dueAt) {
        datesTotal += 1;
        if (predictions[match].dueAt === expected.dueAt) datesCorrect += 1;
      }
    }
    for (const prediction of predictions) {
      const count = counts.get(prediction.kind) ?? { expected: 0, predicted: 0, tp: 0 };
      count.predicted += 1;
      counts.set(prediction.kind, count);
    }
  }

  const byKind: ConversationEvalReport["byKind"] = {};
  let expected = 0;
  let predicted = 0;
  let truePositive = 0;
  for (const [kind, count] of counts) {
    byKind[kind] = metric(count.expected, count.predicted, count.tp);
    expected += count.expected;
    predicted += count.predicted;
    truePositive += count.tp;
  }
  return {
    cases: cases.length,
    overall: metric(expected, predicted, truePositive),
    byKind,
    normalizedValueExact: normalizedTotal === 0 ? 1 : normalizedCorrect / normalizedTotal,
    dateExact: datesTotal === 0 ? 1 : datesCorrect / datesTotal,
    unsupportedQuoteRate: predictionTotal === 0 ? 0 : unsupported / predictionTotal,
  };
}

/** Throw a release-gate report that names every failing slice. */
export function assertConversationEvaluationGates(
  report: ConversationEvalReport,
  gates: ConversationEvalGates = RFC037_CONVERSATION_EVAL_GATES,
): void {
  const failures: string[] = [];
  for (const [kind, minimum] of Object.entries(gates.minimumPrecision)) {
    const actual = report.byKind[kind as ConversationClaimKind]?.precision ?? 0;
    if (actual < (minimum ?? 0)) {
      failures.push(`${kind} precision ${actual.toFixed(3)} < ${(minimum ?? 0).toFixed(3)}`);
    }
  }
  for (const [kind, minimum] of Object.entries(gates.minimumRecall)) {
    const actual = report.byKind[kind as ConversationClaimKind]?.recall ?? 0;
    if (actual < (minimum ?? 0)) {
      failures.push(`${kind} recall ${actual.toFixed(3)} < ${(minimum ?? 0).toFixed(3)}`);
    }
  }
  if (report.dateExact < gates.minimumDateExact) {
    failures.push(
      `date exact ${report.dateExact.toFixed(3)} < ${gates.minimumDateExact.toFixed(3)}`,
    );
  }
  if (report.unsupportedQuoteRate > gates.maximumUnsupportedQuoteRate) {
    failures.push(
      `unsupported quote rate ${report.unsupportedQuoteRate.toFixed(3)} > ${gates.maximumUnsupportedQuoteRate.toFixed(3)}`,
    );
  }
  if (failures.length > 0)
    throw new Error(`conversation evaluation failed:\n${failures.join("\n")}`);
}
