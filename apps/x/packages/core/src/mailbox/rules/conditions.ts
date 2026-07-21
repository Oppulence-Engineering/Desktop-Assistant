/**
 * Rule condition evaluation.
 *
 * Static conditions are evaluated synchronously against the normalized message
 * and thread. AI conditions are delegated to a {@link MailAiMatcher} so the same
 * condition logic works with a real model in production and a deterministic mock
 * in tests. The evaluator never lets an AI condition throw abort the whole rule:
 * a matcher failure is recorded as "not matched" with a reason.
 */

import type { MailboxMessage, MailboxThread } from "../types.js";
import type {
  MailboxRule,
  MailboxRuleCondition,
  RuleConditionResult,
  StringMatchOp,
} from "./types.js";

/** Result of asking the model whether a thread satisfies a freeform instruction. */
export type MailAiMatchResult = {
  matched: boolean;
  confidence: number;
  reason?: string;
};

export interface MailAiMatcher {
  match(input: {
    instructions: string;
    minConfidence: number;
    thread: MailboxThread;
    message: MailboxMessage;
  }): Promise<MailAiMatchResult>;
}

export function compareString(value: string, op: StringMatchOp, target: string): boolean {
  const v = value ?? "";
  switch (op) {
    case "equals":
      return v.toLowerCase() === target.toLowerCase();
    case "contains":
      return v.toLowerCase().includes(target.toLowerCase());
    case "regex":
      try {
        return new RegExp(target, "i").test(v);
      } catch {
        return false;
      }
  }
}

function bodyText(message: MailboxMessage): string {
  return message.textBody ?? message.snippet ?? "";
}

function threadAgeDays(thread: MailboxThread, now: number): number {
  return (now - thread.latestMessageAt) / (24 * 60 * 60 * 1000);
}

export async function evaluateRuleConditions(input: {
  rule: MailboxRule;
  thread: MailboxThread;
  message: MailboxMessage;
  aiMatcher: MailAiMatcher;
  now?: number;
}): Promise<RuleConditionResult[]> {
  const now = input.now ?? Date.now();
  const results: RuleConditionResult[] = [];

  for (const condition of input.rule.conditions) {
    results.push(await evaluateCondition(condition, input, now));
  }

  return results;
}

async function evaluateCondition(
  condition: MailboxRuleCondition,
  input: {
    thread: MailboxThread;
    message: MailboxMessage;
    aiMatcher: MailAiMatcher;
  },
  now: number,
): Promise<RuleConditionResult> {
  const { thread, message } = input;

  switch (condition.type) {
    case "from_email":
      return {
        condition,
        matched: compareString(message.from.email, condition.op, condition.value),
        source: "static",
      };

    case "from_domain": {
      const domain = message.from.email.split("@")[1]?.toLowerCase() ?? "";
      return {
        condition,
        matched: compareString(domain, condition.op, condition.value.toLowerCase()),
        source: "static",
      };
    }

    case "to": {
      const matched = message.to.some((p) => compareString(p.email, condition.op, condition.value));
      return { condition, matched, source: "static" };
    }

    case "subject":
      return {
        condition,
        matched: compareString(message.subject, condition.op, condition.value),
        source: "static",
      };

    case "body":
      return {
        condition,
        matched: compareString(bodyText(message), condition.op, condition.value),
        source: "static",
      };

    case "has_attachment":
      return {
        condition,
        matched: message.attachments.length > 0 === condition.value,
        source: "static",
      };

    case "category":
      return {
        condition,
        matched: thread.categories.includes(condition.categoryId),
        source: "static",
      };

    case "provider_label":
      return {
        condition,
        matched:
          thread.labels.includes(condition.labelId) || message.labels.includes(condition.labelId),
        source: "static",
      };

    case "direction":
      return {
        condition,
        matched: (condition.value === "outbound") === message.isOutbound,
        source: "static",
      };

    case "thread_age_days": {
      const age = threadAgeDays(thread, now);
      const matched = condition.op === "gt" ? age > condition.value : age < condition.value;
      return { condition, matched, source: "static" };
    }

    case "ai": {
      try {
        const ai = await input.aiMatcher.match({
          instructions: condition.instructions,
          minConfidence: condition.minConfidence,
          thread,
          message,
        });
        return {
          condition,
          matched: ai.matched && ai.confidence >= condition.minConfidence,
          confidence: ai.confidence,
          reason: ai.reason,
          source: "ai",
        };
      } catch (error) {
        return {
          condition,
          matched: false,
          source: "ai",
          reason: `AI condition evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
  }
}

export function ruleMatched(rule: MailboxRule, results: RuleConditionResult[]): boolean {
  if (results.length === 0) return false;
  if (rule.conditionalOperator === "AND") return results.every((r) => r.matched);
  return results.some((r) => r.matched);
}

/** True when the rule has any AI condition that would require a model call. */
export function ruleHasAiConditions(rule: MailboxRule): boolean {
  return rule.conditions.some((c) => c.type === "ai");
}
