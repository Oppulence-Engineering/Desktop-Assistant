/**
 * Public API for the provider-neutral mailbox module.
 *
 * This is the surface other packages import. Internal wiring stays in the
 * sibling files; consumers should depend on the service facade and the shared
 * types, not on individual engine components.
 */

export * from "./types.js";
export * from "./errors.js";
export { capabilitiesFromScopes, hasCapability, requireCapability } from "./capabilities.js";
export {
  stableHash,
  normalizeMailboxAccountId,
  normalizeMailboxThreadId,
  normalizeMailboxMessageId,
  makeRuleRunDedupeKey,
} from "./ids.js";

export type { MailboxProvider } from "./provider.js";
export { GmailMailboxProvider, type GmailBridge } from "./provider-gmail.js";
export { createGmailBridge } from "./provider-gmail-bridge.js";
export {
  DefaultMailboxProviderRegistry,
  type MailboxProviderRegistry,
} from "./provider-registry.js";
export {
  normalizeGmailSnapshot,
  parseAddress,
  parseAddressList,
  threadToSummary,
} from "./normalize.js";

export {
  InMemoryMailboxStore,
  type MailboxStore,
  type MailboxStoreState,
  type MailboxSyncState,
  type MailboxSenderProfile,
  type MailboxCategory,
  type MailboxProposal,
} from "./store.js";
export { PersistentMailboxStore } from "./store-fs.js";

export { computeMailboxBackoff } from "./sync-jobs.js";
export { MailboxSyncController } from "./sync-controller.js";

// rules
export * from "./rules/types.js";
export {
  evaluateRuleConditions,
  ruleMatched,
  ruleHasAiConditions,
  compareString,
  type MailAiMatcher,
  type MailAiMatchResult,
} from "./rules/conditions.js";
export {
  decideActionPolicy,
  isHighImpactAction,
  HIGH_IMPACT_ACTIONS,
  type ActionPolicyDecision,
} from "./rules/policy.js";
export { MailboxAuditLog } from "./rules/audit.js";
export { MailboxScheduledActionScheduler } from "./rules/scheduler.js";
export { MailboxActionRunner, type MailboxActionHooks } from "./rules/actions.js";
export { MailboxRuleEngine, evaluateLearnedPatterns } from "./rules/engine.js";
export { previewRule, findActionConflicts, describePlannedAction } from "./rules/preview.js";

// reply zero
export * from "./reply/types.js";
export {
  transitionTracker,
  shouldCreateNudge,
  type ReplyTrackerEvent,
} from "./reply/state-machine.js";
export { ReplyTrackerService, type ReplyClassifier } from "./reply/tracker.js";
export {
  ensureSingleDraftSuggestion,
  assertDraftStillFresh,
  computeThreadMessageSetVersion,
  type MailDraftGenerator,
  type GeneratedDraft,
} from "./reply/drafts.js";
export { findRelevantReplyMemories, recordReplyMemory } from "./reply/memory.js";

// privacy
export {
  redactEmailForLog,
  redactStringForLog,
  redactThreadForPrompt,
} from "./privacy/redaction.js";
export {
  buildMailPromptContext,
  MAIL_UNTRUSTED_CONTENT_GUARD,
} from "./privacy/prompt-injection.js";
export {
  buildExternalMailPayload,
  signWebhookPayload,
  verifyWebhookSignature,
} from "./privacy/payload-policy.js";

// evals
export * from "./evals/fixtures.js";
export {
  runMailEvalSuite,
  compareEvalResult,
  type MailEvaluator,
  type MailEvalResult,
  type MailEvalSuiteResult,
} from "./evals/runner.js";

// AI implementations
export {
  LlmAiMatcher,
  LlmReplyClassifier,
  LlmDraftGenerator,
  deriveReplyRecipients,
} from "./ai.js";

// service
export {
  MailboxService,
  createDefaultMailboxService,
  getMailboxService,
  type MailboxServiceDeps,
} from "./service.js";
