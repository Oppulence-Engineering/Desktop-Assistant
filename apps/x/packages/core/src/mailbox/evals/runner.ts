/**
 * Evaluation runner.
 *
 * Runs an evaluator against the fixture suite and scores each case with a
 * target-specific comparator. Kept independent of any specific model so it can
 * run over a real classifier in CI or a stub in unit tests.
 */

import type { MailEvalCase, MailEvalTarget } from "./fixtures.js";

export type MailEvalActual = Record<string, unknown>;

export interface MailEvaluator {
  evaluate(testCase: MailEvalCase): Promise<MailEvalActual>;
}

export type MailEvalResult = {
  caseId: string;
  target: MailEvalTarget;
  passed: boolean;
  actual: MailEvalActual;
  expected: Record<string, unknown>;
  tags: string[];
  notes?: string;
};

export type MailEvalSuiteResult = {
  total: number;
  passed: number;
  failed: number;
  results: MailEvalResult[];
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

export function compareEvalResult(input: {
  target: MailEvalTarget;
  expected: Record<string, unknown>;
  actual: MailEvalActual;
}): { passed: boolean; notes?: string } {
  const { expected, actual } = input;

  switch (input.target) {
    case "cold_email": {
      if (actual.isColdEmail !== expected.isColdEmail) {
        return { passed: false, notes: `expected isColdEmail=${expected.isColdEmail}` };
      }
      if (expected.reasonIncludes) {
        const reason = asString(actual.reason).toLowerCase();
        if (!reason.includes(asString(expected.reasonIncludes).toLowerCase())) {
          return { passed: false, notes: `reason missing "${expected.reasonIncludes}"` };
        }
      }
      return { passed: true };
    }

    case "needs_reply":
      return actual.status === expected.status
        ? { passed: true }
        : { passed: false, notes: `expected status=${expected.status}, got ${actual.status}` };

    case "category":
      return actual.category === expected.category
        ? { passed: true }
        : {
            passed: false,
            notes: `expected category=${expected.category}, got ${actual.category}`,
          };

    case "draft_reply": {
      const to = Array.isArray(actual.to) ? actual.to.map(asString) : [];
      if (expected.toIncludes && !to.includes(asString(expected.toIncludes))) {
        return { passed: false, notes: `recipient missing ${expected.toIncludes}` };
      }
      if (expected.toExcludes && to.includes(asString(expected.toExcludes))) {
        return { passed: false, notes: `recipient must exclude ${expected.toExcludes}` };
      }
      return { passed: true };
    }

    case "rule_match":
      return actual.matched === expected.matched
        ? { passed: true }
        : { passed: false, notes: `expected matched=${expected.matched}` };
  }
}

export async function runMailEvalSuite(input: {
  cases: MailEvalCase[];
  evaluator: MailEvaluator;
}): Promise<MailEvalSuiteResult> {
  const results: MailEvalResult[] = [];

  for (const testCase of input.cases) {
    const actual = await input.evaluator.evaluate(testCase);
    const { passed, notes } = compareEvalResult({
      target: testCase.target,
      expected: testCase.expected,
      actual,
    });

    results.push({
      caseId: testCase.id,
      target: testCase.target,
      passed,
      actual,
      expected: testCase.expected,
      tags: testCase.tags,
      notes,
    });
  }

  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results,
  };
}
