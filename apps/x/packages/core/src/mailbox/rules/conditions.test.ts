import { describe, expect, it } from "vitest";

import { compareString, evaluateRuleConditions, ruleMatched } from "./conditions.js";
import { FakeAiMatcher, makeMessage, makeRule, makeThread } from "../factories.testkit.js";

describe("compareString", () => {
  it("supports equals/contains/regex case-insensitively", () => {
    expect(compareString("Hello", "equals", "hello")).toBe(true);
    expect(compareString("hello world", "contains", "WORLD")).toBe(true);
    expect(compareString("abc123", "regex", "\\d+")).toBe(true);
  });

  it("returns false for an invalid regex instead of throwing", () => {
    expect(compareString("x", "regex", "([")).toBe(false);
  });
});

describe("evaluateRuleConditions", () => {
  const matcher = new FakeAiMatcher({ matched: true, confidence: 0.9 });

  it("evaluates static conditions", async () => {
    const rule = makeRule({
      conditions: [
        { type: "from_domain", op: "equals", value: "example.com" },
        { type: "has_attachment", value: false },
      ],
    });
    const message = makeMessage({ from: { email: "a@example.com" } });
    const results = await evaluateRuleConditions({
      rule,
      thread: makeThread({ messages: [message] }),
      message,
      aiMatcher: matcher,
    });
    expect(results.every((r) => r.matched)).toBe(true);
  });

  it("applies the AI matcher confidence threshold", async () => {
    const lowMatcher = new FakeAiMatcher({ matched: true, confidence: 0.4 });
    const rule = makeRule({
      conditions: [{ type: "ai", instructions: "urgent?", minConfidence: 0.7 }],
    });
    const message = makeMessage();
    const results = await evaluateRuleConditions({
      rule,
      thread: makeThread({ messages: [message] }),
      message,
      aiMatcher: lowMatcher,
    });
    expect(results[0].matched).toBe(false);
    expect(results[0].source).toBe("ai");
  });

  it("treats an AI matcher error as not matched", async () => {
    const throwing = {
      async match() {
        throw new Error("model down");
      },
    };
    const rule = makeRule({ conditions: [{ type: "ai", instructions: "x", minConfidence: 0.5 }] });
    const message = makeMessage();
    const results = await evaluateRuleConditions({
      rule,
      thread: makeThread({ messages: [message] }),
      message,
      aiMatcher: throwing,
    });
    expect(results[0].matched).toBe(false);
    expect(results[0].reason).toContain("failed");
  });
});

describe("ruleMatched", () => {
  it("AND requires every condition", () => {
    const rule = makeRule({ conditionalOperator: "AND" });
    expect(
      ruleMatched(rule, [
        { condition: {} as never, matched: true, source: "static" },
        { condition: {} as never, matched: false, source: "static" },
      ]),
    ).toBe(false);
  });

  it("OR requires any condition", () => {
    const rule = makeRule({ conditionalOperator: "OR" });
    expect(
      ruleMatched(rule, [
        { condition: {} as never, matched: false, source: "static" },
        { condition: {} as never, matched: true, source: "static" },
      ]),
    ).toBe(true);
  });

  it("empty condition set never matches", () => {
    expect(ruleMatched(makeRule(), [])).toBe(false);
  });
});
