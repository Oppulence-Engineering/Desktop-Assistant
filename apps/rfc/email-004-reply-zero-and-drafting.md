# RFC email-004: Reply Zero and AI Drafting

| Field      | Value                           |
| ---------- | ------------------------------- |
| RFC        | email-004                       |
| Status     | Draft                           |
| Track      | Desktop email                   |
| Owner      | TBD                             |
| Created    | 2026-06-12                      |
| Depends on | email-001, email-002, email-003 |
| Related    | email-006, email-007            |

## Summary

Add a Reply Zero workflow for tracking conversations that need a response, conversations where Rowboat is waiting on someone else, and AI-assisted draft replies. Inbox Zero treats this as a first-class product area with To Reply and Awaiting Reply labels, follow-up lists, nudge drafts, configurable follow-up age, and auto-drafting. Rowboat already classifies threads as important/other and can generate a draft response in the Gmail sync path, but it does not persist conversation state as a product workflow.

This RFC turns reply handling into a durable mailbox feature with thread trackers, AI drafts, user corrections, writing style memory, and outbound/inbound state transitions.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect:

- `docs/essentials/reply-zero.mdx`
- `apps/web/prisma/schema.prisma` models `ThreadTracker`, `DraftSendLog`, `ReplyMemory`, `ReplyMemorySource`
- `apps/web/prisma/schema.prisma` enums `ThreadTrackerType`, `DraftReplyConfidence`, `DraftEmailStatus`
- `apps/web/utils/ai/reply/determine-thread-status.ts`
- `apps/web/utils/ai/reply/draft-reply.ts`
- `apps/web/utils/ai/reply/draft-follow-up.ts`
- `apps/web/utils/ai/reply/generate-nudge.ts`
- `apps/web/utils/ai/reply/reply-context-collector.ts`
- `apps/web/utils/ai/reply/reply-memory.ts`
- `apps/web/utils/ai/reply/summarize-learned-writing-style.ts`
- `apps/web/utils/reply-tracker/draft-tracking.ts`
- `apps/web/utils/reply-tracker/draft-similarity.ts`
- `apps/web/utils/follow-up/process.ts`
- `apps/web/utils/follow-up/follow-up-actions.ts`
- `apps/web/app/api/follow-up-reminders/route.ts`

Adapt the state machine and draft lifecycle, but keep Rowboat's default as user-reviewed drafts, not autonomous replies.

## Source Analysis

| Source fact                                                                                                                                                 | Evidence                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Inbox Zero's Reply Zero docs describe To Reply and Awaiting Reply labels, needs reply/waiting lists, nudge drafts, and done/filter-by-age workflows.        | `inbox-zero/docs/essentials/reply-zero.mdx`                                                                 |
| Inbox Zero stores follow-up thresholds, auto-draft settings, draft cleanup days, writing style, learned writing style, and reply memories at account level. | `inbox-zero/apps/web/prisma/schema.prisma` `EmailAccount`, `ReplyMemory`, `Knowledge`                       |
| Inbox Zero models reply state as thread trackers with statuses such as awaiting and needs reply, follow-up timestamps, draft IDs, and notification flags.   | `inbox-zero/apps/web/prisma/schema.prisma` `ThreadTracker`                                                  |
| Inbox Zero processes outbound messages to update reply tracking and clears follow-up labels when inbound mail arrives.                                      | `inbox-zero/apps/web/utils/webhook/process-history-item.ts`                                                 |
| Rowboat currently has a classifier that can generate `draftResponse` for Gmail threads using message context, style guide, and calendar context.            | `apps/x/packages/core/src/knowledge/classify_thread.ts`, `apps/x/packages/core/src/knowledge/sync_gmail.ts` |

## Goals

- Provide durable queues for Needs Reply and Awaiting Reply.
- Track outbound and inbound messages to move threads between states.
- Generate user-editable draft replies with transparent reasoning.
- Learn writing style from user-approved drafts and explicit notes.
- Avoid repeated draft churn on every sync tick.
- Let users mark threads done, defer follow-up, or convert a reply need into a task.

## Non-Goals

- Fully autonomous replying by default.
- Replacing existing compose/reply UI.
- Building full CRM relationship management.
- Building calendar booking features in this RFC, except as context for draft content.

## Thread Tracker Model

```ts
type MailboxThreadTracker = {
  id: string;
  accountId: string;
  threadId: string;
  providerThreadId: string;
  status: "needs_reply" | "awaiting_reply" | "needs_action" | "done";
  reason?: string;
  confidence?: number;
  dueAt?: string;
  followUpAppliedAt?: string;
  followUpDraftId?: string;
  lastInboundMessageId?: string;
  lastOutboundMessageId?: string;
  notificationSentAt?: string;
  createdAt: string;
  updatedAt: string;
};
```

Status semantics:

- `needs_reply`: latest meaningful inbound message expects a response from the user.
- `awaiting_reply`: latest meaningful outbound message expects a response from someone else.
- `needs_action`: no email reply is required, but the user owes a non-email action.
- `done`: no follow-up required.

## State Transitions

| Event                                                 | Transition                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| Meaningful inbound asks a question or requests action | `needs_reply`                                                    |
| User sends reply                                      | `awaiting_reply` or `done`, depending on content and user choice |
| Recipient replies                                     | Re-evaluate to `needs_reply`, `needs_action`, or `done`          |
| User marks done                                       | `done`                                                           |
| Due date passes in awaiting state                     | Create nudge draft or notification                               |
| Rule labels thread as FYI/actioned                    | `done` unless user override exists                               |

Transitions should be idempotent and auditable.

## Draft Generation

Drafts are generated from:

- Full thread context.
- User writing style notes.
- Learned writing style.
- Relevant knowledge snippets.
- Calendar availability, when connected.
- Prior reply memories for similar sender/thread patterns.
- Requested action, such as "short polite decline" or "schedule next week."

The engine should produce:

```ts
type MailboxDraftSuggestion = {
  id: string;
  trackerId: string;
  threadId: string;
  providerDraftId?: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  to: MailboxParticipant[];
  cc: MailboxParticipant[];
  bcc: MailboxParticipant[];
  confidence: number;
  reasoningSummary?: string;
  citations?: MailboxMessageCitation[];
  source: "manual" | "rule" | "nudge" | "assistant";
  status: "suggested" | "created_provider_draft" | "edited" | "sent" | "discarded";
};
```

Provider drafts should be created only when the user enables that behavior or asks for it. Otherwise the draft can live inside Rowboat until opened.

## Confidence Policy

- Low confidence: show suggestion only; do not create provider draft.
- Medium confidence: create Rowboat draft and highlight uncertain assumptions.
- High confidence: create provider draft when account setting allows it.
- Auto-send: disabled by default and gated by rule-level explicit policy from email-003.

The default threshold should favor avoiding noisy drafts over maximum automation.

## Writing Style and Reply Memory

Store three types of writing context:

1. User-authored style guide, including the existing file path concept in Rowboat.
2. Learned writing style summary derived from sent messages with user consent.
3. Reply memories from accepted/edited drafts, keyed by sender/domain/pattern.

Data model:

```ts
type ReplyMemory = {
  id: string;
  accountId: string;
  senderEmail?: string;
  senderDomain?: string;
  pattern: string;
  instruction: string;
  examples?: string[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
};
```

Users must be able to inspect and delete learned memories.

## Nudge Drafts

For `awaiting_reply` threads, Rowboat can generate follow-up drafts:

- "Just checking in" follow-up after configured days.
- Context-aware escalation if thread has a date/deadline.
- No nudge if sender has replied.
- No duplicate nudge if a draft already exists.
- Cancel scheduled nudge if thread state changes.

Nudge drafts should integrate with scheduled actions from email-003.

## UI Requirements

Reply Zero view:

- Needs Reply queue.
- Awaiting Reply queue.
- Needs Action queue.
- Done archive.
- Filters by age, sender, label, account, and confidence.
- Bulk "mark done" and "defer" actions.
- Draft preview inline in row or inspector.
- Clear indicator for provider draft versus Rowboat draft.

Thread inspector:

- Tracker status.
- Why Rowboat thinks a reply is needed.
- Draft confidence and assumptions.
- Follow-up due date.
- Buttons: draft reply, create nudge, mark done, awaiting reply, needs action.

## Provider Actions

Requires from email-001:

- Read thread.
- Create/update/delete draft.
- Send draft.
- Detect outbound sent messages.
- Detect inbound replies.
- Apply labels/folders when available.

Provider labels such as `To Reply` and `Awaiting Reply` may be created as optional interoperability, but Rowboat state is the source of truth.

## Privacy and Safety

- Drafts containing sensitive data should remain local unless the user creates provider drafts.
- Learned writing style should be local-first and deletable.
- Never auto-send by default.
- Show recipients clearly before send.
- Recheck thread freshness before sending a draft generated from stale context.

## Detailed Code Examples

See [email-021](./email-021-implementation-blueprints-and-code-examples.md) for the full reply tracker state machine.

### Draft Dedupe

The draft service should avoid creating a new provider draft every time sync sees the same thread:

```ts
export async function ensureSingleDraftSuggestion(input: {
  accountId: string;
  thread: MailboxThread;
  source: "reply_zero" | "nudge" | "assistant" | "rule";
  store: MailboxStore;
  draftGenerator: MailDraftGenerator;
}): Promise<MailboxDraftSuggestion> {
  const existing = await input.store.findOpenDraftSuggestion({
    accountId: input.accountId,
    threadId: input.thread.id,
    source: input.source,
  });

  const threadVersion = computeThreadMessageSetVersion(input.thread);

  if (existing?.threadVersion === threadVersion) {
    return existing;
  }

  const generated = await input.draftGenerator.generate({
    accountId: input.accountId,
    thread: input.thread,
    source: input.source,
  });

  if (existing) {
    return input.store.updateDraftSuggestion(existing.id, {
      threadVersion,
      subject: generated.subject,
      bodyText: generated.bodyText,
      confidence: generated.confidence,
      reasoningSummary: generated.reasoningSummary,
    });
  }

  return input.store.createDraftSuggestion({
    accountId: input.accountId,
    threadId: input.thread.id,
    providerThreadId: input.thread.providerThreadId,
    threadVersion,
    source: input.source,
    subject: generated.subject,
    bodyText: generated.bodyText,
    confidence: generated.confidence,
    status: "suggested",
  });
}
```

### Freshness Check Before Send

```ts
export async function assertDraftStillFresh(input: {
  draft: MailboxDraftSuggestion;
  provider: MailboxProvider;
  store: MailboxStore;
}): Promise<void> {
  const latest = await input.provider.getThread({
    accountId: input.draft.accountId,
    provider: input.provider.kind,
    providerThreadId: input.draft.providerThreadId,
  });

  const latestVersion = computeThreadMessageSetVersion(latest);
  if (latestVersion !== input.draft.threadVersion) {
    await input.store.markDraftSuggestionStale(input.draft.id, {
      latestThreadVersion: latestVersion,
    });

    throw new Error("Draft was generated from stale thread context. Regenerate before sending.");
  }
}
```

## Migration Plan

1. Persist thread tracker state locally.
2. Convert existing Gmail `draftResponse` into a `MailboxDraftSuggestion`.
3. Add Needs Reply and Awaiting Reply queues to the command center.
4. Detect outbound messages and inbound replies from sync events.
5. Add nudge scheduling and cancellation.
6. Add writing style memory import from existing style guide file.
7. Add optional provider label creation.

## Test Plan

- Unit tests for tracker state transitions.
- Fake-timer tests for follow-up due dates and nudge scheduling.
- Tests proving duplicate sync events do not create duplicate drafts.
- Tests for draft generation policy by confidence threshold.
- Provider mock tests for create/update/delete/send draft.
- UI tests for Needs Reply/Awaiting Reply queue updates.
- Manual test: inbound request -> draft -> send -> awaiting -> recipient reply -> needs reply.

## Open Questions

- Should Rowboat create provider-visible drafts by default, or keep drafts local until user opens them?
- What confidence threshold should ship for automatic draft creation?
- Should follow-up age be global, per account, per sender, or per rule?
- How should user corrections feed back into the classifier versus reply memory?
