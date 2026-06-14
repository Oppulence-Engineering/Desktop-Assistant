# RFC email-010: AI Mail Assistant Chat

| Field      | Value                                                 |
| ---------- | ----------------------------------------------------- |
| RFC        | email-010                                             |
| Status     | Draft                                                 |
| Track      | Desktop email                                         |
| Owner      | TBD                                                   |
| Created    | 2026-06-12                                            |
| Depends on | email-001, email-002, email-003, email-012            |
| Related    | email-004, email-005, email-008, email-015, email-016 |

## Summary

Add a mail-aware assistant chat that can search, summarize, draft, explain, configure, and propose actions across the user's inbox. Inbox Zero's AI chat can manage mail, bulk archive/unsubscribe, create/edit rules, configure features, explain prior automation, and work through Slack or Telegram. Rowboat should adapt that concept into the desktop command center and existing agent runtime, while making all mutations pass through the same action engine, approval policy, and audit trail as non-chat automation.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect:

- `docs/essentials/ai-chat.mdx`
- `apps/web/prisma/schema.prisma` models `Chat`, `ChatMessage`, `ChatCompaction`, `ChatMemory`
- `apps/web/utils/ai/assistant/chat.ts`
- `apps/web/utils/ai/assistant/chat-inbox-tools.ts`
- `apps/web/utils/ai/assistant/chat-rule-tools.ts`
- `apps/web/utils/ai/assistant/chat-calendar-tools.ts`
- `apps/web/utils/ai/assistant/chat-folder-tools.ts`
- `apps/web/utils/ai/assistant/chat-label-tools.ts`
- `apps/web/utils/ai/assistant/manage-inbox-actions.ts`
- `apps/web/utils/ai/assistant/inline-email-actions.ts`
- `apps/web/utils/ai/assistant/chat-memory-policy.ts`
- `apps/web/utils/ai/assistant/compact.ts`
- `apps/web/utils/actions/assistant-chat.ts`
- `apps/web/app/api/chat/route.ts`
- `apps/web/app/api/chat/confirm-email-action/route.ts`

Use these for assistant tool taxonomy, mutating-action confirmation, chat memory, and compaction. Rowboat should adapt the behavior into desktop IPC/runtime tools and keep provider actions behind email-003 policy.

## Goals

- Let users ask natural-language questions about email.
- Let users issue natural-language commands that become explicit proposed actions.
- Reuse mailbox search, semantic memory, rules, and action engine.
- Make assistant explanations grounded in actual thread/rule/action records.
- Preserve local-first privacy and support local model routing where configured.
- Keep chat memory useful without becoming an unbounded data sink.

## Non-Goals

- A general chatbot unrelated to email.
- A second mutation path that bypasses action approval.
- Slack/Telegram command GA before desktop chat is reliable.
- Permanent retention of all chat messages by default.

## User Jobs

The assistant should support:

- "Find the email from Sarah about the invoice."
- "Summarize unread investor emails."
- "Draft a short reply asking for Tuesday or Thursday."
- "Why was this email archived?"
- "Create a rule to archive newsletters from this sender."
- "Show senders I should unsubscribe from."
- "What follow-ups are overdue?"
- "Add emails from this domain to a weekly digest."
- "Fix the rule that is mislabeling receipts."
- "What changed in my inbox today?"

## Tool Surface

Assistant tools should be typed and narrow:

| Tool                             | Reads                         | Mutates                          |
| -------------------------------- | ----------------------------- | -------------------------------- |
| `mailbox.search`                 | Indexed metadata and snippets | No                               |
| `mailbox.get_thread`             | Thread body if authorized     | No                               |
| `mailbox.summarize_thread`       | Thread and memory context     | No                               |
| `mailbox.draft_reply`            | Thread, style, calendar       | Creates Rowboat draft suggestion |
| `mailbox.propose_action`         | Thread/rule context           | Creates proposed action only     |
| `mailbox.execute_action`         | Action proposal               | Yes, policy-gated                |
| `mailbox.list_rules`             | Rule metadata                 | No                               |
| `mailbox.propose_rule`           | User intent and examples      | Creates disabled rule draft      |
| `mailbox.test_rule`              | Rule and sample threads       | No                               |
| `mailbox.get_stats`              | Aggregates                    | No                               |
| `mailbox.get_followups`          | Reply tracker                 | No                               |
| `mailbox.get_cleanup_candidates` | Sender profiles               | No                               |

The assistant must never call provider APIs directly.

## Chat Memory

Model chat memory after Inbox Zero's chat, compaction, and memory structures, but scope it tightly:

```ts
type MailChat = {
  id: string;
  accountId: string;
  name?: string;
  lastSeenRulesRevision?: number;
  compactionCount: number;
  deletedAt?: string;
};

type MailChatMemory = {
  id: string;
  accountId: string;
  chatId?: string;
  content: string;
  kind: "preference" | "correction" | "workflow" | "style";
  source: "explicit" | "derived";
  expiresAt?: string;
};
```

Useful memories:

- "Archive all fundraising newsletters."
- "Never auto-reply to investors."
- "Use concise replies with no exclamation points."
- "Receipts from Stripe go to Accounting."

Memory must be inspectable and deletable.

## Grounding and Explanations

Every answer that refers to email state should include enough grounding for the UI to show:

- Thread IDs.
- Message IDs.
- Rule IDs.
- Action run IDs.
- Search query used.
- Time window.
- Confidence.

For example, "why was this email archived?" should answer from:

- Rule run.
- Action run.
- Rule version.
- Match metadata.
- Static/AI/learned condition result.

If that evidence is missing, the assistant should say so and offer to inspect related records.

## Proposed Action Flow

1. User asks for a mutation.
2. Assistant calls `mailbox.propose_action`.
3. Action engine validates capability and policy.
4. UI renders proposed action with target, effect, and risk.
5. User approves or edits.
6. `mailbox.execute_action` runs the same path as automation.
7. Action run is recorded.
8. Chat stores a lightweight reference to the result.

Examples of mutations:

- Archive matching threads.
- Apply label.
- Draft reply.
- Create rule.
- Schedule nudge.
- Add to digest.
- Unsubscribe sender.

## Rule Authoring Flow

The assistant can create disabled rule drafts:

```ts
type MailRuleDraft = {
  name: string;
  naturalLanguageIntent: string;
  staticConditions: MailboxRuleCondition[];
  aiInstructions?: string;
  actions: MailboxAction[];
  sampleThreadIds: string[];
  testResults: MailboxRuleTestResult[];
};
```

Before enablement, the user sees:

- Matched sample threads.
- Non-matched near misses.
- Planned actions.
- Risk warnings.
- Required scopes.

## Model Routing

Use Rowboat's model policy:

- Local/small model for search query rewrite, categorization, and simple summaries when available.
- Stronger model for rule authoring, draft replies, and explanation synthesis.
- BYO key support from email-015 where configured.
- No full email body to cloud models unless user setting permits it.

## UI Requirements

### Code Example: Read Tool

```ts
export const searchMailboxTool = defineMailAssistantTool({
  name: "search_mailbox",
  description: "Search indexed mailbox metadata and summaries.",
  input: z.object({
    accountId: z.string().optional(),
    query: z.string().min(1),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  async execute(input, ctx) {
    const results = await ctx.mailSearch.query({
      accountId: input.accountId,
      query: input.query,
      limit: input.limit,
      includeBodies: false,
    });

    return {
      results: results.items.map((item) => ({
        threadId: item.threadId,
        accountId: item.accountId,
        subject: item.subject,
        snippet: item.snippet,
        latestMessageAt: item.latestMessageAt,
        grounding: item.grounding,
      })),
    };
  },
});
```

### Code Example: Mutation Tool Returns Proposal

```ts
export const proposeArchiveTool = defineMailAssistantTool({
  name: "propose_archive_thread",
  description: "Propose archiving a thread. Does not execute the archive.",
  input: z.object({
    accountId: z.string(),
    providerThreadId: z.string(),
    reason: z.string().min(1),
  }),
  async execute(input, ctx) {
    const proposal = await ctx.proposedActions.create({
      accountId: input.accountId,
      actionType: "archive",
      target: { providerThreadId: input.providerThreadId },
      source: "assistant",
      reason: input.reason,
    });

    return {
      proposalId: proposal.id,
      requiresApproval: proposal.requiresApproval,
      display: {
        title: "Archive thread",
        body: input.reason,
      },
    };
  },
});
```

In the command center:

- Chat panel can be opened globally or scoped to a thread.
- Thread-scoped chat starts with selected thread context.
- Global chat can search across accounts if user permits.
- Proposed actions render as structured cards, not hidden text.
- Chat can pin results to queues, drafts, rules, or digest.

## Channel Extension

Slack/Telegram chat should be built after desktop chat:

- Same tools.
- Same action proposal flow.
- External channel confirmation for high-impact actions.
- Reduced payloads by default.
- Link back to desktop/broker for full body and approval.

## Privacy and Retention

- Default chat retention should be configurable.
- Chat compaction should remove raw body snippets unless explicitly retained.
- Do not include secrets or auth tokens in chat memory.
- User can delete all mail assistant memory.
- Local-only mode should disable broker chat persistence.

## Test Plan

- Tool permission tests for read-only versus mutating commands.
- Grounding tests for explanation answers.
- Proposed-action tests proving send/archive/create-rule go through policy.
- Memory retention and deletion tests.
- Prompt evals for rule authoring and cleanup recommendations.
- UI tests for structured action cards.
- Red-team tests for prompt injection in email bodies.

## Open Questions

- Should mail assistant chat live inside the global Rowboat assistant or as a mailbox-scoped panel?
- Should chat memory be per account, per workspace, or both?
- What is the minimum useful local model for privacy-preserving mail chat?
- How should assistant chat handle multiple connected accounts in one answer?
