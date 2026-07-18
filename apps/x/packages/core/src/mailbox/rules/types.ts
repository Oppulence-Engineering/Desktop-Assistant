/**
 * Rule and action model for mailbox automation.
 *
 * A rule is a set of conditions (static, AI, or learned) plus an ordered list
 * of actions. The engine matches rules against normalized messages and runs the
 * actions through a policy gate. Every match and every action produces an audit
 * record so automation is always explainable and reversible where possible.
 */

import type { MailboxProviderKind } from "../types.js";

/** System rules carry product meaning the UI understands, beyond user config. */
export type MailboxSystemType =
  | "TO_REPLY"
  | "AWAITING_REPLY"
  | "NEEDS_ACTION"
  | "FYI"
  | "ACTIONED"
  | "COLD_EMAIL"
  | "NEWSLETTER"
  | "MARKETING"
  | "CALENDAR"
  | "RECEIPT"
  | "NOTIFICATION";

export type StringMatchOp = "equals" | "contains" | "regex";

/** How an external action is allowed to shape its outbound payload. */
export type ExternalPayloadPolicy = {
  includeBody: boolean;
  includeAttachments: boolean;
};

export type MailboxRuleCondition =
  | { type: "from_email"; op: StringMatchOp; value: string }
  | { type: "from_domain"; op: "equals" | "contains"; value: string }
  | { type: "to"; op: StringMatchOp; value: string }
  | { type: "subject"; op: "contains" | "regex"; value: string }
  | { type: "body"; op: "contains" | "regex"; value: string }
  | { type: "has_attachment"; value: boolean }
  | { type: "category"; categoryId: string }
  | { type: "provider_label"; labelId: string }
  | { type: "direction"; value: "inbound" | "outbound" }
  | { type: "thread_age_days"; op: "gt" | "lt"; value: number }
  | { type: "ai"; instructions: string; minConfidence: number };

export type MailboxActionType =
  | "archive"
  | "mark_read"
  | "star"
  | "label"
  | "move"
  | "mark_spam"
  | "trash"
  | "draft_reply"
  | "reply"
  | "send_email"
  | "forward"
  | "digest"
  | "delay"
  | "webhook"
  | "notify_channel";

/** Every action except `delay`. A delay wraps one of these. */
export type MailboxConcreteAction =
  | { id: string; type: "archive" }
  | { id: string; type: "mark_read" }
  | { id: string; type: "star" }
  | { id: string; type: "label"; labelId: string }
  | { id: string; type: "move"; folderId: string }
  | { id: string; type: "mark_spam" }
  | { id: string; type: "trash" }
  | { id: string; type: "draft_reply"; prompt?: string }
  | { id: string; type: "reply"; prompt?: string; autoSend?: boolean }
  | { id: string; type: "send_email"; to: string[]; subject?: string; body?: string }
  | { id: string; type: "forward"; to: string[]; note?: string }
  | { id: string; type: "digest"; priority: "low" | "normal" | "high" }
  | { id: string; type: "webhook"; destinationId: string; payloadPolicy: ExternalPayloadPolicy }
  | { id: string; type: "notify_channel"; channelId: string; payloadPolicy: ExternalPayloadPolicy };

export type MailboxAction =
  | MailboxConcreteAction
  | { id: string; type: "delay"; delayMinutes: number; action: MailboxConcreteAction };

export type MailboxRule = {
  id: string;
  accountId: string;
  name: string;
  enabled: boolean;
  version: number;
  systemType?: MailboxSystemType;
  /** When false, the rule only ever evaluates a thread's latest message once. */
  runOnThreads: boolean;
  conditionalOperator: "AND" | "OR";
  conditions: MailboxRuleCondition[];
  aiInstructions?: string;
  learnedPatternIds: string[];
  actions: MailboxAction[];
  createdAt: number;
  updatedAt: number;
};

/** A sender/domain pattern the engine learned from user corrections. */
export type MailboxLearnedPattern = {
  id: string;
  accountId: string;
  ruleId: string;
  scope: "sender" | "domain";
  value: string;
  /** Positive = "this sender matches this rule"; negative = "never match". */
  polarity: "positive" | "negative";
  confidence: number;
  createdAt: number;
  updatedAt: number;
};

// --- Condition evaluation results -----------------------------------------

export type RuleConditionResult = {
  condition: MailboxRuleCondition;
  matched: boolean;
  source: "static" | "ai" | "learned";
  confidence?: number;
  reason?: string;
};

// --- Audit records ---------------------------------------------------------

export type MailboxRuleRunStatus = "matched" | "skipped" | "failed" | "cancelled";

export type MailboxRuleRun = {
  id: string;
  accountId: string;
  ruleId: string;
  ruleVersion: number;
  dedupeKey: string;
  threadId: string;
  providerThreadId: string;
  messageId?: string;
  status: MailboxRuleRunStatus;
  reason?: string;
  conditionResults?: RuleConditionResult[];
  matchMetadata?: Record<string, unknown>;
  modelMetadata?: Record<string, unknown>;
  createdAt: number;
};

export type MailboxActionRunStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "needs_approval"
  | "denied"
  | "scheduled";

export type MailboxActionRun = {
  id: string;
  accountId: string;
  ruleRunId?: string;
  dedupeKey: string;
  actionType: MailboxActionType;
  source: "rule" | "assistant" | "manual";
  status: MailboxActionRunStatus;
  policyReason: string;
  providerActionId?: string;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
  scheduledFor?: number;
  executedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type MailboxScheduledAction = {
  id: string;
  accountId: string;
  ruleRunId?: string;
  actionId: string;
  /** The concrete action to run when the timer fires (never another delay). */
  action: MailboxConcreteAction;
  threadId: string;
  providerThreadId: string;
  messageId?: string;
  scheduledFor: number;
  status: "scheduled" | "executing" | "executed" | "cancelled" | "failed";
  dedupeKey: string;
  cancelReason?: string;
  createdAt: number;
  updatedAt: number;
};

export type MailboxDigestItem = {
  id: string;
  accountId: string;
  threadId: string;
  messageId?: string;
  ruleRunId?: string;
  priority: "low" | "normal" | "high";
  summary?: string;
  createdAt: number;
  deliveredAt?: number;
};

// --- Rule preview / conflicts ---------------------------------------------

export type MailboxPlannedAction = {
  actionId: string;
  actionType: MailboxActionType;
  description: string;
  highImpact: boolean;
};

export type MailboxRulePreviewResult = {
  threadId: string;
  providerThreadId: string;
  subject: string;
  matched: boolean;
  conditionResults: RuleConditionResult[];
  plannedActions: MailboxPlannedAction[];
};

export type MailboxRulePreview = {
  ruleName: string;
  matchedCount: number;
  totalCount: number;
  results: MailboxRulePreviewResult[];
};

export type MailboxActionConflict = {
  severity: "warning" | "error";
  message: string;
  actionIds: string[];
};

/** Provider kinds a webhook payload may reference; helps typing sync events. */
export type MailboxAutomationTrigger = "sync" | "manual_test" | "backfill" | "assistant";

export type MailboxAutomationInput = {
  accountId: string;
  provider: MailboxProviderKind;
  trigger: MailboxAutomationTrigger;
};
