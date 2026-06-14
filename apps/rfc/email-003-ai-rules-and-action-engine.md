# RFC email-003: AI Rules and Mail Action Engine

| Field      | Value                                                      |
| ---------- | ---------------------------------------------------------- |
| RFC        | email-003                                                  |
| Status     | Draft                                                      |
| Track      | Desktop email                                              |
| Owner      | TBD                                                        |
| Created    | 2026-06-12                                                 |
| Depends on | email-001, email-002                                       |
| Related    | RFC 004, RFC 020, RFC 023, email-004, email-005, email-006 |

## Summary

Build an email automation engine that can classify incoming mail, match user-defined rules, execute safe actions, schedule delayed actions, and record an audit trail. Inbox Zero's core differentiator is not just AI classification; it is the combination of static conditions, AI instructions, learned sender patterns, action execution, delayed actions, digests, webhooks, and rule testing. Rowboat already has a background task runtime and native action direction, but email automation needs a dedicated mailbox-specific contract.

This RFC defines the rule model, action catalog, matching pipeline, execution semantics, safety controls, audit data, and test/fix loop for Rowboat desktop email automation.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect:

- `docs/essentials/email-ai-personal-assistant.mdx`
- `docs/essentials/delayed-actions.mdx`
- `docs/essentials/email-digest.mdx`
- `docs/essentials/call-webhook.mdx`
- `apps/web/prisma/schema.prisma` models `Rule`, `Action`, `RuleHistory`, `ExecutedRule`, `ExecutedAction`, `ScheduledAction`
- `apps/web/prisma/schema.prisma` enums `ActionType`, `SystemType`
- `apps/web/utils/ai/choose-rule/match-rules.ts`
- `apps/web/utils/ai/choose-rule/choose-args.ts`
- `apps/web/utils/ai/choose-rule/run-rules.ts`
- `apps/web/utils/ai/choose-rule/execute.ts`
- `apps/web/utils/ai/actions.ts`
- `apps/web/utils/ai/rule/action-availability.ts`
- `apps/web/utils/ai/rule/create-rule-schema.ts`
- `apps/web/utils/actions/ai-rule.ts`
- `apps/web/utils/scheduled-actions/scheduler.ts`
- `apps/web/utils/scheduled-actions/executor.ts`

Use these as behavior references for matching order, action payloads, delayed actions, rule history, and edge-case tests. Rowboat implementation must still route mutations through the mailbox action policy and audit trail defined here.

## Source Analysis

| Source fact                                                                                                                                                                                     | Evidence                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Inbox Zero rules support AI instructions, static conditions, grouping, thread-level behavior, system types, conditional operators, action lists, and history.                                   | `inbox-zero/apps/web/prisma/schema.prisma` `Rule`, `Action`, `RuleHistory`                                          |
| Inbox Zero action types include archive, label, reply, send, forward, draft email, draft/notify messaging channel, mark spam, webhook, mark read, star, digest, move folder, and notify sender. | `inbox-zero/apps/web/prisma/schema.prisma` `ActionType`                                                             |
| Inbox Zero evaluates cold-email first, uses learned patterns to avoid expensive AI, supports static and AI matching, skips thread re-runs unless configured, and records feedback metadata.     | `inbox-zero/apps/web/utils/ai/choose-rule/match-rules.ts`                                                           |
| Inbox Zero merges AI-generated arguments into action templates, supports prompt placeholders, attachments, and confidence-aware draft generation.                                               | `inbox-zero/apps/web/utils/ai/choose-rule/choose-args.ts`                                                           |
| Inbox Zero records executed rules/actions and can schedule delayed actions with cancellation.                                                                                                   | `inbox-zero/apps/web/utils/ai/choose-rule/run-rules.ts`, `inbox-zero/apps/web/utils/scheduled-actions/scheduler.ts` |
| Rowboat has a background task runtime, event read tools, connector tools, and an RFC for native third-party tool/action execution.                                                              | `apps/rowboat-api/internal/backgroundtaskruntime`, `apps/rfc/020-native-third-party-tool-action-engine.md`          |

## Goals

- Let users create deterministic and AI-assisted email rules.
- Execute mailbox actions through the provider-neutral foundation from email-001.
- Record every rule match, AI decision, action, failure, and user correction.
- Support dry-run/test mode before a rule is enabled.
- Support delayed actions and digest actions.
- Make rule decisions reusable across desktop UI, background tasks, and assistant commands.
- Prevent silent destructive or sending actions.

## Non-Goals

- Building general-purpose agent orchestration for all connectors.
- Auto-sending arbitrary AI-generated email without user policy.
- Replacing Rowboat's existing background task runtime.
- Implementing every channel action before the channel RFCs are complete.

## Rule Model

```ts
type MailboxRule = {
  id: string;
  accountId: string;
  name: string;
  enabled: boolean;
  systemType?: MailboxSystemType;
  runOnThreads: boolean;
  conditionalOperator: "AND" | "OR";
  instructions?: string;
  promptText?: string;
  staticConditions: MailboxRuleCondition[];
  learnedPatternIds: string[];
  actions: MailboxAction[];
  version: number;
  createdAt: string;
  updatedAt: string;
};
```

### Rule Conditions

Support static conditions first:

- From email/domain/contact group
- To/cc/bcc recipient
- Subject contains/regex
- Body contains/regex
- Has attachment
- Provider label/folder
- Rowboat system category
- Sender relationship exists
- Calendar invite present
- Thread age
- Message direction

AI conditions:

- Freeform instructions
- Structured expected output
- Confidence threshold
- Required citations to message spans where possible

Learned patterns:

- Sender-specific pattern
- Domain-specific pattern
- Rule-specific positive/negative feedback
- Skip expensive AI when confidence is high enough

## System Types

Use system rules for common product features:

- `TO_REPLY`
- `AWAITING_REPLY`
- `NEEDS_ACTION`
- `FYI`
- `ACTIONED`
- `COLD_EMAIL`
- `NEWSLETTER`
- `MARKETING`
- `CALENDAR`
- `RECEIPT`
- `NOTIFICATION`

System rules should be editable where safe, but the product should know their semantic meaning.

## Action Catalog

Initial actions:

| Action           | Launch behavior                                                               |
| ---------------- | ----------------------------------------------------------------------------- |
| `ARCHIVE`        | Execute automatically when rule is enabled and account has modify capability. |
| `LABEL`          | Execute automatically.                                                        |
| `MOVE_FOLDER`    | Execute automatically after folder resolution.                                |
| `MARK_READ`      | Execute automatically.                                                        |
| `STAR`           | Execute automatically.                                                        |
| `MARK_SPAM`      | Require confirmation by default; allow explicit trusted rule.                 |
| `DRAFT_EMAIL`    | Create or update draft; never sends by itself.                                |
| `REPLY`          | Default to draft-only unless user explicitly enables auto-send for the rule.  |
| `SEND_EMAIL`     | Require explicit user policy and audit; disabled by default.                  |
| `FORWARD`        | Require confirmation unless recipient is allowlisted.                         |
| `CALL_WEBHOOK`   | Execute with signed secret and retry policy.                                  |
| `DIGEST`         | Queue message/rule result for digest.                                         |
| `DELAY`          | Schedule an action for later execution.                                       |
| `NOTIFY_CHANNEL` | Notify Slack/Telegram/local notification when channels exist.                 |
| `NOTIFY_SENDER`  | Draft or send sender notification depending on policy.                        |

High-impact actions are send, forward, spam, delete/trash, external webhook with body, and external notification with body. They require stricter defaults.

## Matching Pipeline

1. Normalize event into `MailboxAutomationInput`.
2. Load account, provider capabilities, message/thread, sender profile, and prior rule runs.
3. Dedupe by account/thread/message/rule version/event cursor.
4. Apply system prechecks:
   - Ignore user-owned outbound messages unless evaluating reply tracking.
   - Skip ignored senders.
   - Skip old threads unless backfill/test mode.
   - Avoid re-running non-thread rules on the same thread.
5. Evaluate high-confidence learned patterns.
6. Evaluate static conditions.
7. Evaluate AI conditions only for remaining candidate rules.
8. Select applicable rules. Support single-rule or multi-rule modes.
9. Generate action arguments for draft/reply/send/forward/webhook/digest.
10. Execute or schedule actions according to policy.
11. Persist audit records and update learned patterns.

## Execution Semantics

The engine must be idempotent:

- A provider event can be delivered multiple times.
- A desktop and cloud worker can process the same mailbox change.
- A scheduled action can be retried.

Use a deterministic execution key:

```text
account_id + provider + provider_message_id + rule_id + rule_version + action_id + action_index
```

For thread-level actions, use provider thread ID instead of message ID.

## Data Model

### `MailboxRuleRun`

```ts
type MailboxRuleRun = {
  id: string;
  accountId: string;
  ruleId: string;
  ruleVersion: number;
  threadId: string;
  messageId?: string;
  status: "matched" | "skipped" | "failed" | "cancelled";
  reason?: string;
  matchMetadata?: Record<string, unknown>;
  modelMetadata?: Record<string, unknown>;
  createdAt: string;
};
```

### `MailboxActionRun`

```ts
type MailboxActionRun = {
  id: string;
  ruleRunId: string;
  actionType: MailboxActionType;
  status: "pending" | "succeeded" | "failed" | "cancelled" | "needs_approval";
  providerActionId?: string;
  result?: Record<string, unknown>;
  error?: string;
  scheduledFor?: string;
  executedAt?: string;
};
```

### `MailboxScheduledAction`

```ts
type MailboxScheduledAction = {
  id: string;
  accountId: string;
  ruleRunId: string;
  actionId: string;
  scheduledFor: string;
  status: "scheduled" | "executing" | "executed" | "cancelled" | "failed";
  dedupeKey: string;
  cancelReason?: string;
};
```

## Rule Testing and Fix Loop

Inbox Zero's docs emphasize testing rules and fixing mistakes. Rowboat should provide:

- Test rule on selected thread.
- Test rule on search result sample.
- Show why a rule matched or did not match.
- Show planned actions before execution.
- Let user correct category/action.
- Convert correction into learned pattern or rule edit.
- Keep rule history so behavior can be audited after edits.

## Webhook Action Contract

For `CALL_WEBHOOK`, send a minimal signed payload by default:

```json
{
  "email": {
    "accountId": "acct_123",
    "threadId": "thr_123",
    "messageId": "msg_123",
    "subject": "Subject",
    "from": "sender@example.com",
    "snippet": "Short snippet"
  },
  "executedRule": {
    "id": "run_123",
    "ruleId": "rule_123",
    "reason": "Matched static sender condition",
    "createdAt": "2026-06-12T12:00:00Z"
  }
}
```

Headers:

- `X-Rowboat-Webhook-Id`
- `X-Rowboat-Webhook-Timestamp`
- `X-Rowboat-Webhook-Signature`

Full body forwarding must be opt-in per webhook.

## Detailed Code Examples

See [email-021](./email-021-implementation-blueprints-and-code-examples.md) for full TypeScript sketches of rule types, condition evaluation, action policy, action runner, and duplicate-event tests.

### Rule Test Preview

Before a rule is enabled, it should run in preview mode and return exact planned actions:

```ts
export async function previewRule(input: {
  ruleDraft: MailboxRule;
  sampleThreadIds: string[];
  store: MailboxStore;
  matcher: MailAiMatcher;
}): Promise<MailboxRulePreview> {
  const results: MailboxRulePreviewResult[] = [];

  for (const threadId of input.sampleThreadIds) {
    const thread = await input.store.getThreadById(threadId);
    if (!thread) continue;

    const latest = thread.messages.at(-1);
    if (!latest) continue;

    const conditionResults = await evaluateRuleConditions({
      rule: input.ruleDraft,
      thread,
      message: latest,
      aiMatcher: input.matcher,
    });

    const matched = ruleMatched(input.ruleDraft, conditionResults);

    results.push({
      threadId: thread.id,
      providerThreadId: thread.providerThreadId,
      subject: thread.subject,
      matched,
      conditionResults,
      plannedActions: matched ? input.ruleDraft.actions.map(describePlannedAction) : [],
    });
  }

  return {
    ruleName: input.ruleDraft.name,
    matchedCount: results.filter((result) => result.matched).length,
    totalCount: results.length,
    results,
  };
}
```

### Conflict Detection

Rules should warn when planned actions conflict:

```ts
export function findActionConflicts(actions: MailboxAction[]): MailboxActionConflict[] {
  const conflicts: MailboxActionConflict[] = [];
  const hasArchive = actions.some((action) => action.type === "archive");
  const moveActions = actions.filter((action) => action.type === "move");
  const draftActions = actions.filter((action) => action.type === "draft_reply");

  if (hasArchive && moveActions.length > 0) {
    conflicts.push({
      severity: "warning",
      message: "Rule both archives and moves the thread. Move may already remove it from inbox.",
      actionIds: moveActions.map((action) => action.id),
    });
  }

  if (draftActions.length > 1) {
    conflicts.push({
      severity: "error",
      message: "Rule creates more than one reply draft for the same message.",
      actionIds: draftActions.map((action) => action.id),
    });
  }

  return conflicts;
}
```

## Safety Policy

- Autonomous send/forward is off by default.
- Destructive actions need either undo support, provider trash semantics, or explicit user confirmation.
- External actions cannot include full body or attachments unless enabled per rule.
- Rules must show capability requirements before enabling.
- Every action must have an audit row.
- Failed actions should surface in the command center inspector.

## Migration Plan

1. Add rule/action/run models locally behind a feature flag.
2. Add Gmail provider action adapter for archive, label, mark read, draft, reply draft, and digest queue.
3. Add rule test mode in the command center.
4. Add event-driven processing from desktop sync events.
5. Add delayed action scheduler.
6. Add broker/cloud worker support using existing CloudEvent infrastructure.
7. Add webhook and external channel actions.

## Test Plan

- Unit tests for static condition matching.
- Unit tests for AI matching with mocked structured outputs.
- Idempotency tests for duplicate provider events.
- Action execution tests with provider adapter mocks.
- Policy tests proving auto-send/forward/spam are blocked by default.
- Scheduled action tests with fake timers and cancellation.
- UI tests for rule test results and audit display.

## Open Questions

- Should multi-rule execution be account-wide, rule-group-specific, or per inbox queue?
- How should conflicting actions resolve, such as archive plus move folder?
- Should AI prompts be fully user-editable or constrained through templates?
- Which rule data belongs in Rowboat cloud versus local-only desktop storage?
