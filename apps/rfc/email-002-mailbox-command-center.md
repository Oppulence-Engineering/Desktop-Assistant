# RFC email-002: Mailbox Command Center

| Field      | Value                                      |
| ---------- | ------------------------------------------ |
| RFC        | email-002                                  |
| Status     | Draft                                      |
| Track      | Desktop email                              |
| Owner      | TBD                                        |
| Created    | 2026-06-12                                 |
| Depends on | email-001                                  |
| Related    | email-003, email-004, email-005, email-006 |

## Summary

Build the desktop email experience as a mailbox command center rather than a Gmail-only thread viewer. Rowboat already has a useful Gmail UI with important/everything-else lists, thread reading, attachments, compose, reply, reply-all, forward, archive, trash, and mark-read actions. Inbox Zero shows the next layer of product surface: assistant, automation, briefs, bulk archive, bulk unsubscribe, calendars, channels, cold email blocker, drive filing, no-reply, reply-zero, smart categories, and stats.

This RFC proposes a desktop-first mailbox UI that unifies provider mail, AI classifications, triage queues, automation controls, and operational views without turning email into a separate web app.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect these Inbox Zero surfaces for product coverage and UI workflows:

- `docs/essentials/ai-chat.mdx`
- `docs/essentials/reply-zero.mdx`
- `docs/essentials/bulk-archiver.mdx`
- `docs/essentials/bulk-email-unsubscriber.mdx`
- `docs/essentials/cold-email-blocker.mdx`
- `docs/essentials/email-analytics.mdx`
- `apps/web/app/(app)/[emailAccountId]/mail/page.tsx`
- `apps/web/app/(app)/[emailAccountId]/reply-zero/page.tsx`
- `apps/web/app/(app)/[emailAccountId]/bulk-archive/page.tsx`
- `apps/web/app/(app)/[emailAccountId]/bulk-unsubscribe/page.tsx`
- `apps/web/app/(app)/[emailAccountId]/cold-email-blocker/page.tsx`
- `apps/web/app/(app)/[emailAccountId]/stats/page.tsx`
- `apps/web/app/(app)/[emailAccountId]/automation/page.tsx`

Adapt the route-per-feature web app into Rowboat's desktop command center. The Rowboat target is `apps/x/apps/renderer/src/components/email-view.tsx` evolving into provider-neutral mailbox views.

## Source Analysis

| Source fact                                                                                                                                                                                                                               | Evidence                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Inbox Zero exposes email as multiple task-specific routes: assistant, automation, briefs, bulk archive, bulk unsubscribe, calendars, channels, clean, cold email blocker, drive, mail, no-reply, reply-zero, smart categories, and stats. | `inbox-zero/apps/web/app/(app)/[emailAccountId]/...`                              |
| Inbox Zero docs position the product as an AI assistant that can search, manage, archive, reply, forward, send, bulk clean, unsubscribe, create rules, and configure features.                                                            | `inbox-zero/docs/essentials/ai-chat.mdx`                                          |
| Rowboat desktop has a Gmail-specific renderer with inbox buckets, thread detail, attachments, compose/reply/reply-all/forward, archive, trash, mark read, sync status, and message height persistence.                                    | `apps/x/apps/renderer/src/components/email-view.tsx`                              |
| Rowboat desktop IPC currently names Gmail operations directly.                                                                                                                                                                            | `apps/x/apps/main/src/ipc.ts`, `apps/x/packages/core/src/knowledge/sync_gmail.ts` |

## Goals

- Present email as a first-class desktop workspace for triage, writing, cleanup, and automation.
- Preserve the current fast thread-reading and reply flow.
- Add navigable queues for Important, Other, Needs Reply, Awaiting Reply, Newsletters, Cold Outreach, Scheduled, Drafts, and Done.
- Make AI actions visible and correctable from the same surface where the user reads mail.
- Use provider-neutral mailbox APIs from email-001.
- Keep the interface dense and operational, aligned with Rowboat's desktop app.

## Non-Goals

- Rebuilding Inbox Zero route-for-route.
- Adding a marketing-style landing page inside the app.
- Launching every automation feature in the first UI milestone.
- Making the desktop UI depend on cloud availability for basic mail reading.

## Product Shape

The mailbox command center should have four primary regions:

1. Navigation rail: account switcher, mailbox queues, automation, insights, settings.
2. Thread list: compact rows with sender, subject, labels, AI status, unread, latest time, attachment markers, and queued actions.
3. Thread reader: message timeline, HTML/text rendering, attachments, context cards, reply composer, and action toolbar.
4. Inspector: assistant reasoning, rule matches, scheduled actions, related calendar context, sender profile, and automation history.

This replaces the Gmail-only "important/everything else" mental model with a mailbox model that can still default to those two queues.

## Views

### Inbox

Default operational view:

- Important
- Other
- Unread
- Starred
- Attachments
- Recently handled
- Provider folders/labels

Important and Other should continue to use Rowboat's existing classifier initially, then move to the rules/category model in email-003 and email-005.

### Reply Zero

Dedicated queues from email-004:

- Needs Reply
- Awaiting Reply
- Needs Action
- Done
- Nudge drafts

### Cleanup

Bulk workflows from email-005:

- Newsletters
- Cold Outreach
- Old unread
- Large attachments
- Sender cleanup
- One-click archive candidates

### Automation

Rule and action workflow from email-003:

- Rules
- Test rule
- Recent runs
- Scheduled actions
- Failed actions
- Learned patterns

### Insights

Analytics and digest workflow from email-006:

- Volume
- Response times
- Top senders/domains
- Categories
- Automation impact
- Digest queue

## Thread List Requirements

Rows should be stable and compact:

- Sender or sender group
- Subject
- Snippet
- Latest message timestamp
- Unread/read state
- Provider label/folder chips
- Rowboat system category
- Attachment marker
- Draft marker
- Scheduled action marker
- Rule match marker
- Needs reply / awaiting reply marker
- Quick actions: archive, mark read, snooze/defer, reply

The UI should avoid layout shift when labels or AI status load. Use fixed row heights or constrained multi-line rows.

## Thread Reader Requirements

The reader should preserve existing Rowboat strengths:

- Render HTML email safely.
- Show stripped quoted text behind an expand affordance.
- Display inline images and attachments.
- Support reply, reply-all, forward, and send.
- Support archive, trash, mark read.
- Show generated draft and allow editing before send.

New requirements:

- Show provider account and source folder.
- Show rule matches and executed actions.
- Show reply tracking state and follow-up deadline.
- Show sender profile and prior relationship.
- Show attachment filing status when enabled.
- Allow the user to correct category, importance, and rule decisions.

## Assistant Interaction

The assistant panel should act on the selected email context:

- Summarize this thread.
- Draft a reply.
- Extract tasks.
- Mark as needs reply or awaiting reply.
- Create a rule from this sender/thread.
- Archive similar messages.
- Unsubscribe or auto-archive sender.
- File attachments.
- Add to digest.

Assistant actions should use the same action engine and audit trail as background automation. There should not be a separate "chat-only" mutation path.

## IPC and State

Renderer state should move from Gmail-specific commands to mailbox commands:

- `mailbox:listQueues`
- `mailbox:listThreads`
- `mailbox:getThread`
- `mailbox:search`
- `mailbox:getThreadActions`
- `mailbox:executeThreadAction`
- `mailbox:updateThreadClassification`
- `mailbox:getAutomationRuns`
- `mailbox:getSenderProfile`

Compatibility shims can keep existing `gmail:*` IPC for one release.

## Empty, Error, and Offline States

The command center must distinguish:

- No account connected.
- Account connected but missing required scope.
- Auth reconnect required.
- Provider rate limited.
- Cloud unavailable but local cache available.
- Local sync in progress.
- Rule/action failed.

These states matter because many email features should degrade to read-only local mode rather than presenting a generic failure.

## Accessibility and Keyboard

Expected desktop shortcuts:

- `j` / `k`: move selection
- `Enter`: open thread
- `e`: archive
- `r`: reply
- `a`: reply all
- `f`: forward
- `m`: mark read/unread
- `l`: label/move
- `/`: search
- `Cmd+Enter`: send from composer
- `Esc`: close composer or panel

Shortcuts should be discoverable through menus or tooltips, but the interface should not rely on explanatory text blocks.

## Data Dependencies

The UI consumes:

- `MailboxThread` and `MailboxMessage` from email-001.
- `MailboxRuleRun` and action records from email-003.
- `ThreadTracker` state from email-004.
- `SenderProfile` and categories from email-005.
- Analytics summaries from email-006.

## Migration Plan

1. Rename renderer state and IPC consumers from Gmail to mailbox while preserving visible behavior.
2. Add provider account selector and normalized connection status.
3. Add command center navigation with existing Important and Other queues.
4. Add thread inspector with classifier result, draft state, and raw action history placeholders.
5. Add Reply Zero and Cleanup queues as data becomes available.
6. Add Automation and Insights views behind feature flags.
7. Remove direct Gmail IPC calls after compatibility window.

## Test Plan

- Component tests for thread list, thread reader, compose, and queue navigation.
- IPC contract tests for mailbox commands and Gmail compatibility shims.
- Snapshot tests for disconnected, reconnect-required, rate-limited, offline-cache, and sync-in-progress states.
- Manual desktop test on narrow and wide windows for thread list/reader/inspector fit.
- Manual test with long subjects, many labels, large attachments, and HTML-heavy messages.

## Open Questions

- Should email occupy the current email page only, or become a top-level desktop workspace with subnavigation?
- Which queues should ship by default before the automation engine is complete?
- Should local markdown knowledge exports be visible in the UI, or remain an internal artifact?
- How much assistant reasoning should be shown in the inspector by default?
