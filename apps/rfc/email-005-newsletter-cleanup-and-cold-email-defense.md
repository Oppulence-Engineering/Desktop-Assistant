# RFC email-005: Newsletter Cleanup and Cold Email Defense

| Field      | Value                           |
| ---------- | ------------------------------- |
| RFC        | email-005                       |
| Status     | Draft                           |
| Track      | Desktop email                   |
| Owner      | TBD                             |
| Created    | 2026-06-12                      |
| Depends on | email-001, email-002, email-003 |
| Related    | email-004, email-006            |

## Summary

Add a cleanup system for newsletters, marketing mail, cold outreach, old unread mail, and high-volume senders. Inbox Zero has separate product surfaces for bulk archiving, bulk unsubscribing, cold email blocking, smart categories, and cleanup jobs. Rowboat already classifies many of these messages as "other", but the desktop app does not yet have durable sender intelligence, unsubscribe workflows, provider filters, or bulk cleanup controls.

This RFC defines sender profiles, newsletter states, cold-email detection, bulk cleanup jobs, auto-archive filters, unsubscribe handling, and safety controls.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect:

- `docs/essentials/bulk-archiver.mdx`
- `docs/essentials/bulk-email-unsubscriber.mdx`
- `docs/essentials/cold-email-blocker.mdx`
- `apps/web/prisma/schema.prisma` models `Newsletter`, `Category`, `CleanupJob`, `CleanupThread`
- `apps/web/prisma/schema.prisma` enum `NewsletterStatus`
- `apps/web/utils/ai/clean/ai-clean.ts`
- `apps/web/utils/actions/mail-bulk-action.ts`
- `apps/web/utils/actions/unsubscriber.ts`
- `apps/web/utils/cold-email/is-cold-email.ts`
- `apps/web/utils/cold-email/cold-email-rule.ts`
- `apps/web/utils/cold-email/prompt.ts`
- `apps/web/utils/cold-email/send-notification.ts`
- `apps/web/utils/ai/group/find-newsletters.ts`
- `apps/web/utils/ai/group/find-receipts.ts`
- `apps/web/utils/parse/unsubscribe.ts`
- `apps/web/utils/senders/unsubscribe.ts`
- `apps/web/app/api/clean/route.ts`
- `apps/web/app/api/unsubscribe/route.ts`

Use Inbox Zero for sender grouping and cleanup job behavior. Rowboat should keep unsubscribe and cold-email archive actions conservative until eval gates pass.

## Source Analysis

| Source fact                                                                                                                                                    | Evidence                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Inbox Zero's bulk archiver supports archiving by category, sender, date, and label.                                                                            | `inbox-zero/docs/essentials/bulk-archiver.mdx`                      |
| Inbox Zero's newsletter workflow supports unsubscribe, auto-archive, auto-archive plus label, and keep decisions, with sender volume details.                  | `inbox-zero/docs/essentials/bulk-email-unsubscriber.mdx`            |
| Inbox Zero's cold email blocker supports multiple modes, custom prompt, auto label, auto archive plus label, and excludes senders with previous communication. | `inbox-zero/docs/essentials/cold-email-blocker.mdx`                 |
| Inbox Zero persists newsletter/category state and sender statuses such as approved, unsubscribed, and auto-archived.                                           | `inbox-zero/apps/web/prisma/schema.prisma` `Newsletter`, `Category` |
| Rowboat's Gmail classifier already treats newsletters, marketing, notifications, receipts, and cold outreach as lower-priority "other" mail.                   | `apps/x/packages/core/src/knowledge/classify_thread.ts`             |

## Goals

- Help users reduce noisy email without losing important human mail.
- Provide bulk archive and unsubscribe workflows with clear preview and undo.
- Detect cold outreach separately from newsletters and notifications.
- Learn sender-level decisions and apply them to future mail.
- Create provider filters when the user wants future messages handled automatically.
- Keep cleanup actions auditable and reversible where possible.

## Non-Goals

- Unsubscribing from every mailing list automatically on first detection.
- Deleting mail permanently.
- Treating cold email detection as a generic spam filter.
- Training a global classifier on user data without explicit consent.

## Sender Intelligence Model

```ts
type SenderProfile = {
  id: string;
  accountId: string;
  email: string;
  domain: string;
  displayName?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  totalMessages: number;
  unreadMessages: number;
  archivedMessages: number;
  lastInboundAt?: string;
  lastOutboundAt?: string;
  hasUserReplied: boolean;
  hasPreviousConversation: boolean;
  unsubscribeLink?: string;
  listId?: string;
  category?: SenderCategory;
  status: SenderStatus;
  userDecision?: SenderDecision;
};
```

```ts
type SenderCategory =
  | "human"
  | "newsletter"
  | "marketing"
  | "notification"
  | "receipt"
  | "cold_outreach"
  | "calendar"
  | "unknown";

type SenderStatus =
  | "new"
  | "approved"
  | "auto_archive"
  | "auto_archive_and_label"
  | "unsubscribe_requested"
  | "unsubscribed"
  | "blocked"
  | "ignored";
```

## Newsletter Workflow

Newsletter cleanup should group by sender/list:

- Sender name/email/domain.
- Message count.
- Recent message examples.
- Last received date.
- Unread count.
- Detected unsubscribe method.
- Current decision.

Actions:

- Keep in inbox.
- Archive existing messages.
- Auto-archive future messages.
- Auto-archive and label future messages.
- Unsubscribe.
- Unsubscribe and archive existing messages.
- Ignore for now.

Unsubscribe must prefer provider-supported or standards-based mechanisms:

1. `List-Unsubscribe-Post` one-click endpoint when safe and supported.
2. `mailto:` unsubscribe request with confirmation.
3. Link-based unsubscribe opened for user confirmation.
4. Manual instructions if no safe method exists.

The system should not blindly click arbitrary unsubscribe links in the background.

## Cold Email Defense

Cold outreach detection should be conservative:

- Do not classify as cold if the user has sent mail to the sender/domain before.
- Do not classify as cold if the sender is in contacts or organization allowlist.
- Do not classify as cold if the thread was initiated by the user.
- Prefer labeling over archiving until confidence is high.
- Allow user prompt customization for what counts as cold.

Modes:

| Mode              | Behavior                                                                         |
| ----------------- | -------------------------------------------------------------------------------- |
| Monitor           | Detect and show in Cold Outreach queue only.                                     |
| Label             | Apply Rowboat/provider label.                                                    |
| Archive and label | Archive and label high-confidence cold outreach.                                 |
| Block sender      | Future messages are auto-archived or moved to spam depending on provider/policy. |

Spam marking should require explicit user configuration because providers may treat it as abuse feedback.

## Bulk Archive Jobs

Cleanup jobs operate over a preview set:

```ts
type MailboxCleanupJob = {
  id: string;
  accountId: string;
  kind: "sender" | "category" | "date" | "label" | "query";
  query: MailboxCleanupQuery;
  previewCount: number;
  status: "preview" | "running" | "paused" | "completed" | "failed" | "cancelled";
  action: "archive" | "mark_read" | "label" | "move" | "trash";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};
```

Jobs should process in batches with provider rate-limit handling. Each affected thread gets an item record so partial failures can be retried.

## Provider Filters

When the provider supports filters:

- Gmail: create filter for sender/list and archive/label.
- Outlook: create rule where available.

Filters are optional. Rowboat can also enforce decisions via its sync/automation engine for providers without stable filter APIs.

Filter creation must show the exact future behavior before enabling.

## UI Requirements

Cleanup view:

- Sender/category table with counts and recommended action.
- Preview drawer showing example messages.
- Bulk select and action toolbar.
- Confidence and reason for classification.
- Undo/restore for recent archive actions when provider supports it.
- Status for provider filter creation.
- Separate tabs for Newsletters, Cold Outreach, Notifications, Receipts, Old Unread, and Large Senders.

Thread inspector:

- Sender profile.
- Classification reason.
- Buttons: keep, auto-archive, unsubscribe, mark cold, never cold.

## Integration with Rules

Cleanup decisions should compile into rules from email-003:

- Sender approved: skip cold/newsletter cleanup.
- Sender auto-archive: static sender condition + archive action.
- Sender auto-archive and label: static sender condition + label + archive.
- Cold email blocker: system rule with AI condition and allowlist checks.
- Newsletter digest: system rule + digest action.

This avoids maintaining a parallel automation engine.

## Safety and Privacy

- Show a preview before bulk actions.
- Never permanently delete in the first version.
- Keep raw email body local unless needed for classification.
- Do not send unsubscribe links or sender lists to external services except selected LLM provider under existing user settings.
- Track all cleanup actions in the audit log.
- Respect provider rate limits and backoff.

## Detailed Code Examples

See [email-021](./email-021-implementation-blueprints-and-code-examples.md) for shared provider/action/policy examples.

### Cleanup Preview

Bulk cleanup should always produce a preview before provider mutation:

```ts
export async function previewCleanupJob(input: {
  accountId: string;
  query: MailboxCleanupQuery;
  store: MailboxStore;
}): Promise<MailboxCleanupPreview> {
  const threads = await input.store.findThreadsForCleanup({
    accountId: input.accountId,
    query: input.query,
    limit: 500,
  });

  return {
    accountId: input.accountId,
    query: input.query,
    threadCount: threads.length,
    unreadCount: threads.filter((thread) => thread.unread).length,
    senderCount: new Set(threads.flatMap((thread) => thread.participants.map((p) => p.email))).size,
    examples: threads.slice(0, 10).map((thread) => ({
      threadId: thread.id,
      providerThreadId: thread.providerThreadId,
      subject: thread.subject,
      latestMessageAt: thread.latestMessageAt,
      snippet: thread.snippet,
    })),
  };
}
```

### Safe Unsubscribe Decision

```ts
export function chooseUnsubscribeMethod(headers: MailHeaders): UnsubscribePlan {
  const oneClick = headers["list-unsubscribe-post"]?.includes("List-Unsubscribe=One-Click");
  const candidates = parseListUnsubscribeHeader(headers["list-unsubscribe"]);

  const httpsCandidate = candidates.find((candidate) => candidate.type === "https");
  const mailtoCandidate = candidates.find((candidate) => candidate.type === "mailto");

  if (oneClick && httpsCandidate) {
    return {
      method: "one_click_https",
      url: httpsCandidate.value,
      requiresUserConfirmation: false,
    };
  }

  if (mailtoCandidate) {
    return {
      method: "mailto",
      address: mailtoCandidate.value,
      requiresUserConfirmation: true,
    };
  }

  if (httpsCandidate) {
    return {
      method: "open_link_for_user",
      url: httpsCandidate.value,
      requiresUserConfirmation: true,
    };
  }

  return {
    method: "none",
    requiresUserConfirmation: true,
  };
}
```

## Migration Plan

1. Add sender profile indexing during mailbox sync.
2. Add newsletter and cold outreach categories using current Rowboat classifier.
3. Add Cleanup view with read-only counts.
4. Add bulk archive preview and execution.
5. Add sender decisions and rule compilation.
6. Add safe unsubscribe handling.
7. Add provider filter creation.
8. Add cold-email custom prompt and confidence controls.

## Test Plan

- Unit tests for sender profile aggregation.
- Classification tests for previous-contact exclusion.
- Unsubscribe parser tests for `List-Unsubscribe` headers.
- Cleanup job tests for batching, retries, and partial failure.
- Rule compilation tests from sender decisions.
- Provider mock tests for filter creation.
- UI tests for preview, bulk selection, and action status.

## Open Questions

- Should unsubscribe actions be local desktop-only, cloud worker, or both?
- What is the default cold email mode: monitor or label?
- How long should undo metadata be retained?
- Should cleanup decisions sync across devices through the broker?
