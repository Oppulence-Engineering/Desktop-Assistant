# RFC email-011: Smart Categories, Tabs, and Labels

| Field      | Value                           |
| ---------- | ------------------------------- |
| RFC        | email-011                       |
| Status     | Draft                           |
| Track      | Desktop email                   |
| Owner      | TBD                             |
| Created    | 2026-06-12                      |
| Depends on | email-001, email-002, email-003 |
| Related    | email-005, email-006, email-016 |

## Summary

Build a native Rowboat category and tab system for email. Inbox Zero has smart categories and a separate browser extension that adds custom Gmail tabs using Gmail search queries. Rowboat should not ship a browser extension for the desktop app; it should use the same idea inside the command center: user-defined and AI-maintained inbox tabs backed by mailbox queries, rules, labels, sender decisions, and categories.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect:

- `docs/essentials/inbox-zero-tabs-extension.mdx`
- `docs/essentials/email-ai-personal-assistant.mdx`
- `apps/web/prisma/schema.prisma` models `Category`, `Newsletter`, `Rule`
- `apps/web/utils/ai/categorize-sender/ai-categorize-senders.ts`
- `apps/web/utils/ai/categorize-sender/ai-categorize-single-sender.ts`
- `apps/web/utils/ai/categorize-sender/format-categories.ts`
- `apps/web/utils/categorize/senders/get-category-overview.ts`
- `apps/web/utils/categorize/senders/archive-category.ts`
- `apps/web/utils/category-config.tsx`
- `apps/web/utils/label/resolve-label.ts`
- `apps/web/utils/label/find-label-by-name.ts`
- `apps/web/utils/gmail/label.ts`
- `apps/web/utils/outlook/label.ts`
- `apps/web/app/api/user/categories/route.ts`
- `apps/web/app/api/user/categorize/senders/categorized/route.ts`
- `apps/web/app/api/user/categorize/senders/uncategorized/route.ts`

Use the extension docs for query-tab behavior and the sender-category code for smart category assignment. Rowboat's target is native desktop tabs, not a Gmail browser extension.

## Goals

- Give users customizable mailbox tabs and queues.
- Make categories reusable across triage, cleanup, automation, analytics, and digests.
- Support both static query tabs and AI-maintained smart tabs.
- Keep provider labels/folders separate from Rowboat categories while allowing sync.
- Let users correct category decisions and improve future classification.

## Non-Goals

- Browser extension support.
- Replacing provider labels/folders entirely.
- Auto-creating provider labels for every Rowboat category by default.
- Building a complex CRM taxonomy before basic categories work.

## Category Model

```ts
type MailCategory = {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  description?: string;
  kind: "system" | "user" | "learned";
  color?: string;
  icon?: string;
  providerLabelId?: string;
  enabled: boolean;
  sortOrder: number;
};
```

System categories:

- Important
- Other
- Needs Reply
- Awaiting Reply
- Newsletter
- Cold Outreach
- Receipt
- Notification
- Calendar
- Marketing
- Attachment
- Digest

## Tab Model

```ts
type MailTab = {
  id: string;
  accountId: string;
  name: string;
  mode: "query" | "category" | "rule" | "system";
  query?: MailboxQuery;
  categoryId?: string;
  ruleId?: string;
  unreadOnly: boolean;
  inboxOnly: boolean;
  sortOrder: number;
  enabled: boolean;
};
```

Tabs are UI views. Categories are semantic labels. A tab can be backed by a category, but they should not be the same object.

## Query Tabs

Query tabs adapt Inbox Zero's extension idea:

- `from:`
- `to:`
- `subject:`
- `has:attachment`
- `is:unread`
- `newer_than:`
- `label:`
- `category:`
- `sender_domain:`
- boolean `AND` / `OR`

The query parser should compile to provider search when possible and local index search otherwise.

Example tabs:

- "To Reply": `in:inbox category:needs_reply`
- "Newsletters": `in:inbox category:newsletter`
- "Receipts": `in:inbox subject:(receipt OR invoice OR order)`
- "Team": `in:inbox sender_domain:company.com`
- "Important Unread": `in:inbox category:important is:unread`

## Smart Category Pipeline

1. Static signals: provider labels, sender profile, headers, known list IDs.
2. Learned sender/category decisions.
3. Rule outputs from email-003.
4. Classifier output when ambiguous.
5. User correction and feedback.
6. Optional provider label sync.

Category assignment should produce explanation metadata:

```ts
type CategoryAssignment = {
  threadId: string;
  categoryId: string;
  source: "provider" | "rule" | "sender_decision" | "classifier" | "manual";
  confidence: number;
  reason?: string;
};
```

## Provider Label Sync

Provider labels are optional interoperability:

- Create provider label for selected category.
- Apply provider label when Rowboat category changes.
- Import provider label as Rowboat category.
- Resolve conflicts if provider label removed externally.

Default should be Rowboat-local categories until the user opts into provider label sync.

## UI Requirements

Tab bar:

- System tabs first.
- User tabs after.
- Overflow menu for many tabs.
- Drag reorder.
- Unread counts.
- Edit tab query.
- Pin/unpin.

Category manager:

- Category list.
- Description.
- Example matching threads.
- Provider label sync toggle.
- Correction history.
- Merge/delete user categories.

Thread inspector:

- Current category assignments.
- Why assigned.
- Correct category.
- Create rule from correction.

## Interaction With Other RFCs

- email-003 uses categories in rule conditions and actions.
- email-005 uses categories to identify cleanup candidates.
- email-006 aggregates categories for analytics and digests.
- email-010 assistant can create tabs/categories.
- email-016 evaluates category accuracy.

## Test Plan

- Query parser tests for search syntax.
- Category assignment tests by signal source.
- Provider label sync tests with conflicts.
- UI tests for tab counts, reorder, and edit.
- Evals for smart category precision/recall.
- Regression tests for user correction precedence over classifier output.

## Open Questions

- Should default tabs be global or account-specific?
- Should categories support multiple assignment per thread at launch?
- Which categories should be synced to provider labels by default, if any?
- Should query syntax be Gmail-like, Rowboat-specific, or both?
