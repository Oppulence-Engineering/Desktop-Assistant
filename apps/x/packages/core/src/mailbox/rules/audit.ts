/**
 * Audit log.
 *
 * Every rule match and every action attempt becomes a durable record before the
 * side effect happens. This is what makes automation explainable ("why did this
 * thread get archived?") and is a hard requirement before any background
 * automation runs (see the safety policy in email-003).
 */

import { makeActionRunDedupeKey } from "../ids.js";
import type { MailboxMessage, MailboxThread } from "../types.js";
import type { MailboxStore } from "../store.js";
import type { ActionPolicyDecision } from "./policy.js";
import type {
  MailboxAction,
  MailboxActionRun,
  MailboxRule,
  MailboxRuleRun,
  RuleConditionResult,
} from "./types.js";

export type RecordRuleRunInput = {
  accountId: string;
  rule: MailboxRule;
  thread: MailboxThread;
  message: MailboxMessage;
  dedupeKey: string;
  status: MailboxRuleRun["status"];
  reason?: string;
  conditionResults: RuleConditionResult[];
  modelMetadata?: Record<string, unknown>;
};

export type RecordActionInput = {
  accountId: string;
  ruleRunId?: string;
  action: MailboxAction;
  actionIndex: number;
  source: MailboxActionRun["source"];
  policy: ActionPolicyDecision;
};

export class MailboxAuditLog {
  constructor(private readonly store: MailboxStore) {}

  async recordRuleRun(input: RecordRuleRunInput): Promise<MailboxRuleRun> {
    return this.store.createRuleRun({
      accountId: input.accountId,
      ruleId: input.rule.id,
      ruleVersion: input.rule.version,
      dedupeKey: input.dedupeKey,
      threadId: input.thread.id,
      providerThreadId: input.thread.providerThreadId,
      messageId: input.message.id,
      status: input.status,
      reason: input.reason,
      conditionResults: input.conditionResults,
      modelMetadata: input.modelMetadata,
    });
  }

  private dedupeKey(input: RecordActionInput): string {
    return makeActionRunDedupeKey({
      accountId: input.accountId,
      ruleRunId: input.ruleRunId ?? `manual:${input.action.id}`,
      actionId: input.action.id,
      actionIndex: input.actionIndex,
    });
  }

  private async create(
    input: RecordActionInput,
    status: MailboxActionRun["status"],
    extra: Partial<MailboxActionRun> = {},
  ): Promise<MailboxActionRun> {
    return this.store.createActionRun({
      accountId: input.accountId,
      ruleRunId: input.ruleRunId,
      dedupeKey: this.dedupeKey(input),
      actionType: input.action.type,
      source: input.source,
      status,
      policyReason: input.policy.reason,
      ...extra,
    });
  }

  recordActionStarted(input: RecordActionInput): Promise<MailboxActionRun> {
    return this.create(input, "pending");
  }

  recordActionDenied(input: RecordActionInput): Promise<MailboxActionRun> {
    return this.create(input, "denied");
  }

  recordActionNeedsApproval(input: RecordActionInput): Promise<MailboxActionRun> {
    return this.create(input, "needs_approval");
  }

  recordActionScheduled(input: RecordActionInput, scheduledFor: number): Promise<MailboxActionRun> {
    return this.create(input, "scheduled", { scheduledFor });
  }

  async recordActionSucceeded(
    id: string,
    result: Record<string, unknown>,
  ): Promise<MailboxActionRun> {
    return this.store.updateActionRun(id, {
      status: "succeeded",
      result,
      executedAt: Date.now(),
    });
  }

  async recordActionFailed(id: string, error: Record<string, unknown>): Promise<MailboxActionRun> {
    return this.store.updateActionRun(id, { status: "failed", error, executedAt: Date.now() });
  }
}
