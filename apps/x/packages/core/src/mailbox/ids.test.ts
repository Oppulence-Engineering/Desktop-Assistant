import { describe, expect, it } from "vitest";

import {
  makeActionRunDedupeKey,
  makeRuleRunDedupeKey,
  normalizeMailboxThreadId,
  stableHash,
} from "./ids.js";

describe("stableHash", () => {
  it("is deterministic for the same parts", () => {
    expect(stableHash(["a", "b", "c"])).toBe(stableHash(["a", "b", "c"]));
  });

  it("does not collide when part boundaries shift", () => {
    // Length-prefixing must make ["a","bc"] and ["ab","c"] distinct.
    expect(stableHash(["a", "bc"])).not.toBe(stableHash(["ab", "c"]));
  });

  it("changes when any part changes", () => {
    expect(stableHash(["a", "b"])).not.toBe(stableHash(["a", "c"]));
  });
});

describe("normalizeMailboxThreadId", () => {
  it("is stable across calls for the same provider thread", () => {
    const input = { provider: "gmail" as const, accountId: "acct_1", providerThreadId: "t1" };
    expect(normalizeMailboxThreadId(input)).toBe(normalizeMailboxThreadId(input));
  });

  it("differs across accounts", () => {
    const a = normalizeMailboxThreadId({
      provider: "gmail",
      accountId: "acct_1",
      providerThreadId: "t1",
    });
    const b = normalizeMailboxThreadId({
      provider: "gmail",
      accountId: "acct_2",
      providerThreadId: "t1",
    });
    expect(a).not.toBe(b);
  });
});

describe("dedupe keys", () => {
  it("rule-run key is stable and version-sensitive", () => {
    const base = {
      accountId: "acct_1",
      providerMessageId: "m1",
      providerThreadId: "t1",
      ruleId: "rule_1",
      ruleVersion: 1,
    };
    expect(makeRuleRunDedupeKey(base)).toBe(makeRuleRunDedupeKey(base));
    expect(makeRuleRunDedupeKey(base)).not.toBe(makeRuleRunDedupeKey({ ...base, ruleVersion: 2 }));
  });

  it("action-run key is stable per action index", () => {
    const base = { accountId: "acct_1", ruleRunId: "run_1", actionId: "act_1", actionIndex: 0 };
    expect(makeActionRunDedupeKey(base)).toBe(makeActionRunDedupeKey(base));
    expect(makeActionRunDedupeKey(base)).not.toBe(
      makeActionRunDedupeKey({ ...base, actionIndex: 1 }),
    );
  });
});
