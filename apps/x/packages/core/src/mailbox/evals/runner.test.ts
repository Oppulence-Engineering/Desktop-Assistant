import { describe, expect, it } from "vitest";

import { compareEvalResult, runMailEvalSuite, type MailEvaluator } from "./runner.js";
import { coreMailEvalCases } from "./fixtures.js";

describe("compareEvalResult", () => {
  it("passes a correct cold-email verdict with the required reason", () => {
    const { passed } = compareEvalResult({
      target: "cold_email",
      expected: { isColdEmail: false, reasonIncludes: "prior contact" },
      actual: { isColdEmail: false, reason: "Excluded due to prior contact" },
    });
    expect(passed).toBe(true);
  });

  it("fails when a draft addresses the account owner", () => {
    const { passed } = compareEvalResult({
      target: "draft_reply",
      expected: { toIncludes: "friend@example.com", toExcludes: "user@company.com" },
      actual: { to: ["friend@example.com", "user@company.com"] },
    });
    expect(passed).toBe(false);
  });
});

describe("runMailEvalSuite", () => {
  it("scores an evaluator against the fixtures", async () => {
    // A perfect evaluator that returns exactly what each case expects.
    const perfect: MailEvaluator = {
      async evaluate(testCase) {
        switch (testCase.target) {
          case "cold_email":
            return { isColdEmail: testCase.expected.isColdEmail, reason: "prior contact" };
          case "needs_reply":
            return { status: testCase.expected.status };
          case "category":
            return { category: testCase.expected.category };
          case "draft_reply":
            return { to: [testCase.expected.toIncludes] };
          case "rule_match":
            return { matched: testCase.expected.matched };
        }
      },
    };

    const result = await runMailEvalSuite({ cases: coreMailEvalCases, evaluator: perfect });
    expect(result.total).toBe(coreMailEvalCases.length);
    expect(result.failed).toBe(0);
  });
});
