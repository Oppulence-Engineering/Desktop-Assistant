/**
 * Rule engine.
 *
 * Matches enabled rules against a normalized message and runs their actions.
 * Matching order follows email-003: system prechecks → learned patterns (cheap,
 * skip expensive AI when confident) → static conditions → AI conditions →
 * execute. Every rule evaluation is deduped by a deterministic key so repeated
 * provider events (or a desktop and cloud worker seeing the same change) never
 * double-run.
 */

import { makeRuleRunDedupeKey, stableHash } from "../ids.js";
import type { MailboxMessage, MailboxThread } from "../types.js";
import type { MailboxStore } from "../store.js";
import type { MailboxActionRunner } from "./actions.js";
import { MailboxAuditLog } from "./audit.js";
import { evaluateRuleConditions, ruleMatched, type MailAiMatcher } from "./conditions.js";
import type {
  MailboxAutomationTrigger,
  MailboxLearnedPattern,
  MailboxRule,
  MailboxRuleRun,
  RuleConditionResult,
} from "./types.js";

export type MailboxRuleEngineDeps = {
  store: MailboxStore;
  aiMatcher: MailAiMatcher;
  actionRunner: MailboxActionRunner;
  audit: MailboxAuditLog;
  now?: () => number;
  /** Threads whose latest message is older than this are skipped outside backfill/test. */
  maxThreadAgeDaysForAuto?: number;
};

export type ProcessMessageInput = {
  accountId: string;
  thread: MailboxThread;
  message: MailboxMessage;
  trigger: MailboxAutomationTrigger;
};

type LearnedVerdict =
  | { kind: "force_skip"; reason: string }
  | { kind: "force_match"; reason: string; confidence: number }
  | { kind: "none" };

export class MailboxRuleEngine {
  constructor(private readonly deps: MailboxRuleEngineDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  async processMessage(input: ProcessMessageInput): Promise<MailboxRuleRun[]> {
    // System precheck: never auto-run rules on the account owner's own outbound
    // messages (reply tracking handles those separately).
    if (input.message.isOutbound && input.trigger !== "manual_test") {
      return [];
    }

    // System precheck: skip stale threads outside backfill/test so enabling a
    // rule does not retroactively churn the whole mailbox.
    const maxAge = this.deps.maxThreadAgeDaysForAuto;
    if (
      maxAge !== undefined &&
      input.trigger === "sync" &&
      this.now() - input.thread.latestMessageAt > maxAge * 24 * 60 * 60 * 1000
    ) {
      return [];
    }

    const rules = await this.deps.store.listEnabledRules(input.accountId);
    const runs: MailboxRuleRun[] = [];

    for (const rule of rules) {
      const run = await this.processRule(rule, input);
      if (run) runs.push(run);
    }

    return runs;
  }

  private dedupeKeyFor(rule: MailboxRule, input: ProcessMessageInput): string {
    if (!rule.runOnThreads) {
      // Non-thread rules evaluate a thread once, regardless of new messages.
      return stableHash([
        "rule_run_thread_v1",
        input.accountId,
        input.thread.providerThreadId,
        rule.id,
        String(rule.version),
      ]);
    }
    return makeRuleRunDedupeKey({
      accountId: input.accountId,
      providerMessageId: input.message.providerMessageId,
      providerThreadId: input.thread.providerThreadId,
      ruleId: rule.id,
      ruleVersion: rule.version,
    });
  }

  private async processRule(
    rule: MailboxRule,
    input: ProcessMessageInput,
  ): Promise<MailboxRuleRun | null> {
    const dedupeKey = this.dedupeKeyFor(rule, input);

    if (input.trigger !== "manual_test") {
      const existing = await this.deps.store.getRuleRunByDedupeKey(dedupeKey);
      if (existing) return existing;
    }

    const patterns = await this.deps.store.listLearnedPatterns(input.accountId, rule.id);
    const learned = evaluateLearnedPatterns(patterns, input.message);

    let conditionResults: RuleConditionResult[];
    let matched: boolean;
    let reason: string | undefined;

    if (learned.kind === "force_skip") {
      matched = false;
      conditionResults = [];
      reason = learned.reason;
    } else if (learned.kind === "force_match") {
      matched = true;
      conditionResults = [
        {
          condition: { type: "ai", instructions: "learned pattern", minConfidence: 0 },
          matched: true,
          source: "learned",
          confidence: learned.confidence,
          reason: learned.reason,
        },
      ];
      reason = learned.reason;
    } else {
      conditionResults = await evaluateRuleConditions({
        rule,
        thread: input.thread,
        message: input.message,
        aiMatcher: this.deps.aiMatcher,
        now: this.now(),
      });
      matched = ruleMatched(rule, conditionResults);
    }

    const run = await this.deps.audit.recordRuleRun({
      accountId: input.accountId,
      rule,
      thread: input.thread,
      message: input.message,
      dedupeKey,
      status: matched ? "matched" : "skipped",
      reason,
      conditionResults,
    });

    if (!matched || input.trigger === "manual_test") {
      return run;
    }

    let actionIndex = 0;
    for (const action of rule.actions) {
      await this.deps.actionRunner.run({
        accountId: input.accountId,
        ruleRunId: run.id,
        actionIndex: actionIndex++,
        action,
        thread: input.thread,
        message: input.message,
        source: "rule",
      });
    }

    return run;
  }
}

export function evaluateLearnedPatterns(
  patterns: MailboxLearnedPattern[],
  message: MailboxMessage,
): LearnedVerdict {
  const email = message.from.email.toLowerCase();
  const domain = email.split("@")[1] ?? "";

  const matches = patterns.filter((p) => {
    const value = p.value.toLowerCase();
    return p.scope === "sender" ? value === email : value === domain;
  });

  const negative = matches.find((p) => p.polarity === "negative");
  if (negative) {
    return { kind: "force_skip", reason: `Learned negative pattern for ${negative.value}` };
  }

  const positive = matches
    .filter((p) => p.polarity === "positive")
    .sort((a, b) => b.confidence - a.confidence)[0];
  if (positive && positive.confidence >= 0.9) {
    return {
      kind: "force_match",
      reason: `Learned positive pattern for ${positive.value}`,
      confidence: positive.confidence,
    };
  }

  return { kind: "none" };
}
