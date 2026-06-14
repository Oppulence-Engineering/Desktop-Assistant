# RFC email-006: Digests, Analytics, and Mail Insights

| Field      | Value                           |
| ---------- | ------------------------------- |
| RFC        | email-006                       |
| Status     | Draft                           |
| Track      | Desktop email                   |
| Owner      | TBD                             |
| Created    | 2026-06-12                      |
| Depends on | email-001, email-002, email-003 |
| Related    | email-004, email-005, email-007 |

## Summary

Add email digests and analytics that help users understand their inbox, response patterns, senders, categories, automation impact, and cleanup opportunities. Inbox Zero exposes both daily/weekly digests and email analytics: sent/received volume, top senders/domains/recipients, categories, reads/archives, large emails, and response-time metrics. Rowboat already has the raw ingredients through Gmail sync and future mailbox indexing, but not a dedicated insights layer.

This RFC defines digest queues, schedules, insight aggregates, response-time metrics, automation analytics, and privacy boundaries for local-first email analytics.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect:

- `docs/essentials/email-digest.mdx`
- `docs/essentials/email-analytics.mdx`
- `apps/web/prisma/schema.prisma` models `EmailMessage`, `ResponseTime`, `Digest`, `DigestItem`
- `apps/web/utils/digest/index.ts`
- `apps/web/utils/digest/format.ts`
- `apps/web/utils/digest/schedule.ts`
- `apps/web/utils/digest/send-digest.ts`
- `apps/web/utils/digest/summary-limit.ts`
- `apps/web/utils/ai/digest/summarize-email-for-digest.ts`
- `apps/web/utils/stats.ts`
- `apps/web/utils/stats/response-time/calculate.ts`
- `apps/web/utils/stats/response-time/controller.ts`
- `apps/web/app/api/user/stats/by-period/route.ts`
- `apps/web/app/api/user/stats/response-time/route.ts`
- `apps/web/app/api/user/stats/rule-stats/route.ts`
- `apps/web/app/api/user/stats/newsletters/route.ts`

Use these for aggregate shapes, response-time semantics, digest schedule behavior, and summary limits. Rowboat should default to local analytics unless a feature explicitly needs broker sync.

## Source Analysis

| Source fact                                                                                                                               | Evidence                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Inbox Zero supports a digest action where matched messages are collected for daily or weekly digest delivery.                             | `inbox-zero/docs/essentials/email-digest.mdx`, `inbox-zero/apps/web/prisma/schema.prisma` `ActionType.DIGEST`, `Digest`, `DigestItem` |
| Inbox Zero analytics include sent/received per day, top senders/domains/recipients, categories, reads, archives, and large emails.        | `inbox-zero/docs/essentials/email-analytics.mdx`                                                                                      |
| Inbox Zero stores email message metadata and response-time records separately from full message bodies.                                   | `inbox-zero/apps/web/prisma/schema.prisma` `EmailMessage`, `ResponseTime`                                                             |
| Rowboat desktop already extracts message headers, bodies, attachments, unread state, importance, summaries, and drafts during Gmail sync. | `apps/x/packages/core/src/knowledge/sync_gmail.ts`                                                                                    |

## Goals

- Provide useful email analytics without requiring cloud storage of full email bodies.
- Let rules and manual actions add messages to digest queues.
- Support daily, weekly, and manual digest generation.
- Measure response time and follow-up health.
- Show automation impact: archived, labeled, drafted, skipped, failed.
- Feed cleanup and command center recommendations.

## Non-Goals

- Building business-wide team email analytics.
- Storing full raw email bodies in Rowboat cloud by default.
- Replacing provider search/reporting tools.
- Sending digests externally without explicit channel configuration.

## Digest Model

```ts
type MailDigest = {
  id: string;
  accountId: string;
  schedule: "manual" | "daily" | "weekly";
  destination: "desktop" | "email" | "slack" | "telegram";
  status: "scheduled" | "generating" | "sent" | "failed";
  periodStart: string;
  periodEnd: string;
  sentAt?: string;
  summary?: string;
};
```

```ts
type MailDigestItem = {
  id: string;
  digestId?: string;
  accountId: string;
  threadId: string;
  messageId?: string;
  ruleRunId?: string;
  reason: string;
  priority: "low" | "normal" | "high";
  addedAt: string;
};
```

Sources of digest items:

- Rule action from email-003.
- Manual "add to digest" action in thread reader.
- System categories such as newsletters or notifications.
- Important unread summary.
- Reply Zero overdue summary.

## Digest Generation

Digest content should include:

- Highest priority threads.
- One-line summaries.
- Sender and timestamp.
- Suggested action, if available.
- Links back to Rowboat thread view.
- Grouping by category/rule/sender.

Delivery channels:

- Desktop digest view.
- Email to self.
- Slack/Telegram when email-007 channels are configured.
- Local note export if a notes integration exists.

Generation should use local indexed metadata and hydrate full bodies only for selected digest items that need summarization.

## Analytics Model

Store daily aggregates:

```ts
type MailDailyStats = {
  id: string;
  accountId: string;
  date: string;
  receivedCount: number;
  sentCount: number;
  unreadCount: number;
  archivedCount: number;
  draftedCount: number;
  repliedCount: number;
  automatedActionCount: number;
  failedActionCount: number;
  attachmentCount: number;
  attachmentBytes: number;
};
```

Sender/domain aggregates:

```ts
type MailSenderStats = {
  id: string;
  accountId: string;
  senderEmail?: string;
  domain: string;
  receivedCount: number;
  sentCount: number;
  archivedCount: number;
  unreadCount: number;
  averageResponseSeconds?: number;
  lastSeenAt: string;
};
```

Response-time records:

```ts
type MailResponseTime = {
  id: string;
  accountId: string;
  threadId: string;
  inboundMessageId: string;
  outboundMessageId?: string;
  startedAt: string;
  respondedAt?: string;
  responseSeconds?: number;
  status: "open" | "responded" | "closed";
};
```

## Insight Views

Insights page:

- Inbox volume over time.
- Sent versus received.
- Unread trend.
- Top senders.
- Top domains.
- Top recipients.
- Category breakdown.
- Newsletter/cold/notification share.
- Average response time.
- Overdue reply count.
- Automation impact.
- Large attachment list.
- Digest history.

Command center cards:

- "High-volume senders to clean up."
- "Threads waiting on your reply."
- "Automation failures needing review."
- "Large attachments worth filing or deleting."
- "Newsletters added to this week's digest."

## Automation Impact Metrics

Each rule/action run from email-003 should feed aggregates:

- Matched rules.
- Skipped rules.
- Actions executed.
- Actions requiring approval.
- Failed actions.
- Estimated messages archived.
- Drafts created.
- Digests queued.
- Provider API errors and rate limits.

These metrics are useful for trust: the user can see what the system did and why.

## Privacy Boundary

Default:

- Full bodies remain local.
- Analytics use metadata and derived counts.
- Digest summaries are generated locally when possible.
- Cloud sync of aggregates is opt-in or tied to signed-in multi-device features.

Allowed aggregate fields in cloud:

- Counts by day.
- Counts by category.
- Rule/action status counts.
- Hashed sender/domain keys where possible.

Not allowed in cloud by default:

- Message body.
- Subject line.
- Full recipient lists.
- Attachment content.
- Raw unsubscribe links.

## Data Freshness

Analytics should update from:

- Mailbox sync events.
- Provider watches.
- Manual actions.
- Rule/action runs.
- Scheduled maintenance job for backfilled response times.

The UI should show last indexed time and allow rebuild of local aggregates.

## Detailed Code Examples

See [email-021](./email-021-implementation-blueprints-and-code-examples.md) for shared store/eval examples.

### Daily Aggregate Builder

```ts
export function buildDailyStats(input: {
  accountId: string;
  date: string;
  messages: MailboxMessage[];
  actionRuns: MailboxActionRun[];
}): MailDailyStats {
  const received = input.messages.filter((message) => !message.sent);
  const sent = input.messages.filter((message) => message.sent);

  return {
    id: stableHash(["mail_daily_stats_v1", input.accountId, input.date]),
    accountId: input.accountId,
    date: input.date,
    receivedCount: received.length,
    sentCount: sent.length,
    unreadCount: input.messages.filter((message) => message.unread).length,
    archivedCount: input.actionRuns.filter(
      (run) => run.actionType === "archive" && run.status === "succeeded",
    ).length,
    draftedCount: input.actionRuns.filter(
      (run) => run.actionType === "draft_reply" && run.status === "succeeded",
    ).length,
    repliedCount: sent.filter((message) => message.providerThreadId).length,
    automatedActionCount: input.actionRuns.filter((run) => run.source === "rule").length,
    failedActionCount: input.actionRuns.filter((run) => run.status === "failed").length,
    attachmentCount: input.messages.reduce(
      (count, message) => count + message.attachments.length,
      0,
    ),
    attachmentBytes: input.messages.reduce(
      (sum, message) =>
        sum +
        message.attachments.reduce((inner, attachment) => inner + (attachment.sizeBytes ?? 0), 0),
      0,
    ),
  };
}
```

### Digest Item Dedupe

```ts
export async function enqueueDigestItem(input: {
  store: MailboxStore;
  accountId: string;
  threadId: string;
  messageId?: string;
  ruleRunId?: string;
  reason: string;
  priority: "low" | "normal" | "high";
}): Promise<MailDigestItem> {
  const dedupeKey = stableHash([
    "digest_item_v1",
    input.accountId,
    input.threadId,
    input.messageId ?? "thread",
    input.ruleRunId ?? "manual",
  ]);

  return input.store.upsertDigestItem({
    dedupeKey,
    accountId: input.accountId,
    threadId: input.threadId,
    messageId: input.messageId,
    ruleRunId: input.ruleRunId,
    reason: input.reason,
    priority: input.priority,
  });
}
```

## Migration Plan

1. Add local metadata index from mailbox sync.
2. Add daily and sender aggregate builders.
3. Add Insights view with read-only volume and top-sender cards.
4. Add digest item queue and manual add-to-digest action.
5. Add digest generation for desktop-only view.
6. Add scheduled daily/weekly digest.
7. Add automation impact metrics after email-003 lands.
8. Add optional channel/email delivery.

## Test Plan

- Unit tests for aggregate builders.
- Response-time tests for inbound/outbound thread sequences.
- Digest queue idempotency tests.
- Fake-timer tests for daily/weekly schedule.
- Privacy tests proving body/subject fields are not included in cloud aggregate payloads.
- UI tests for empty, partial, and stale analytics states.
- Manual test: sync mail, archive messages, send reply, run digest, verify stats update.

## Open Questions

- Should digest summaries be generated by the desktop LLM path, cloud LLM path, or both?
- Which analytics should appear in the command center versus a dedicated insights page?
- How should analytics handle multiple connected email accounts?
- Should sender/domain names be visible in cloud-synced analytics, or local-only?
