# RFC email-000: Inbox Zero Agent Reference Map

| Field      | Value                       |
| ---------- | --------------------------- |
| RFC        | email-000                   |
| Status     | Draft                       |
| Track      | Desktop email               |
| Owner      | TBD                         |
| Created    | 2026-06-12                  |
| Depends on | None                        |
| Related    | email-001 through email-021 |

## Summary

This RFC is an implementation reference map for AI agents working on Rowboat email features. It points to the exact Inbox Zero source files, docs, schema models, API routes, and tests that should be inspected before implementing the corresponding Rowboat RFCs.

The Inbox Zero checkout used for this analysis is:

```text
/Users/dyomba/go/src/github.com/Oppulence-Engineering/inbox-zero
```

The Rowboat checkout is:

```text
/Users/dyomba/go/src/github.com/Oppulence-Engineering/rowboat
```

## Agent Instructions

Before implementing any Rowboat email RFC:

1. Read this file.
2. Read the target Rowboat RFC.
3. Read the Inbox Zero files listed for that RFC.
4. Do not copy code blindly. Adapt product concepts to Rowboat's desktop-first, local-first architecture.
5. Treat Inbox Zero as a reference implementation for behavior, data shape, and edge cases.
6. Treat Rowboat's existing Gmail sync, broker, CloudEvent, and background-runtime boundaries as the implementation constraints.
7. Use [email-021](./email-021-implementation-blueprints-and-code-examples.md) for concrete TypeScript and Go code sketches after reading the target feature RFC.

## Global Inbox Zero References

| Area                  | Inbox Zero paths                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product docs          | `docs/essentials/*.mdx`                                                                                                                                         |
| Public API docs       | `docs/api-reference/**/*.mdx`, `docs/openapi.json`                                                                                                              |
| Prisma schema         | `apps/web/prisma/schema.prisma`                                                                                                                                 |
| Provider abstraction  | `apps/web/utils/email/provider.ts`, `apps/web/utils/email/types.ts`, `apps/web/utils/email/provider-types.ts`                                                   |
| Gmail provider        | `apps/web/utils/gmail/*.ts`                                                                                                                                     |
| Outlook provider      | `apps/web/utils/outlook/*.ts`                                                                                                                                   |
| Rule engine           | `apps/web/utils/ai/choose-rule/*.ts`, `apps/web/utils/ai/actions.ts`                                                                                            |
| Assistant chat        | `apps/web/utils/ai/assistant/*.ts`, `apps/web/utils/actions/assistant-chat*.ts`                                                                                 |
| Reply tracking        | `apps/web/utils/ai/reply/*.ts`, `apps/web/utils/reply-tracker/*.ts`, `apps/web/utils/follow-up/*.ts`                                                            |
| Cleanup/unsubscribe   | `apps/web/utils/ai/clean/ai-clean.ts`, `apps/web/utils/actions/unsubscriber.ts`, `apps/web/utils/parse/unsubscribe.ts`, `apps/web/utils/senders/unsubscribe.ts` |
| Categories            | `apps/web/utils/ai/categorize-sender/*.ts`, `apps/web/utils/categorize/senders/*.ts`, `apps/web/utils/category-config.tsx`                                      |
| Digests/stats         | `apps/web/utils/digest/*.ts`, `apps/web/utils/stats.ts`, `apps/web/utils/stats/response-time/*.ts`                                                              |
| Attachments/drive     | `apps/web/utils/drive/*.ts`, `apps/web/utils/drive/providers/*.ts`, `apps/web/utils/ai/document-filing/*.ts`                                                    |
| Calendar/booking      | `apps/web/utils/calendar/**/*.ts`, `apps/web/utils/ai/calendar/*.ts`, `apps/web/utils/booking/*.ts`                                                             |
| Meeting briefs        | `apps/web/utils/ai/meeting-briefs/*.ts`, `apps/web/app/api/meeting-briefs/route.ts`                                                                             |
| Messaging channels    | `apps/web/utils/messaging/**/*.ts`, `apps/web/utils/automation-jobs/*.ts`                                                                                       |
| Provider webhooks     | `apps/web/utils/webhook/**/*.ts`, `apps/web/app/api/google/webhook/route.ts`, `apps/web/app/api/outlook/webhook/route.ts`                                       |
| Schedulers            | `apps/web/utils/schedule.ts`, `apps/web/utils/scheduled-actions/*.ts`, `apps/web/app/api/cron/*.ts`                                                             |
| Security/model policy | `apps/web/utils/ai/security.ts`, `apps/web/utils/ai/content-sanitizer.ts`, `apps/web/utils/ai/assistant/chat-response-guard.ts`                                 |
| Debug routes          | `apps/web/app/api/user/debug/**/*.ts`, `apps/web/app/(app)/[emailAccountId]/debug/**/*.tsx`                                                                     |

## Schema Model Reference

Implementation agents should inspect these Prisma models and translate them into Rowboat-local and broker-side equivalents only where needed:

| Feature area             | Inbox Zero schema models/enums                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Account and settings     | `EmailAccount`, `DraftReplyConfidence`                                                                           |
| Rules/actions            | `Rule`, `Action`, `RuleHistory`, `ExecutedRule`, `ExecutedAction`, `ScheduledAction`, `ActionType`, `SystemType` |
| Categories/cleanup       | `Category`, `Newsletter`, `NewsletterStatus`, `CleanupJob`, `CleanupThread`                                      |
| Mail metadata/stats      | `EmailMessage`, `ResponseTime`                                                                                   |
| Reply tracking           | `ThreadTracker`, `ThreadTrackerType`, `DraftSendLog`, `DraftEmailStatus`                                         |
| Knowledge/memory/chat    | `Knowledge`, `ReplyMemory`, `ReplyMemorySource`, `Chat`, `ChatMessage`, `ChatCompaction`, `ChatMemory`           |
| API/ecosystem            | `ApiKey`, `ApiKeyScope`, `EmailToken`                                                                            |
| Calendar/briefs          | `CalendarConnection`, `Calendar`, `BookingLink`, `BookingWindow`, `Booking`, `MeetingBriefing`                   |
| Channels/automation jobs | `MessagingChannel`, `MessagingRoute`, `AutomationJob`, `AutomationJobRun`, `AutomationJobRunStatus`              |
| Drive/filing             | `DriveConnection`, `FilingFolder`, `DocumentFiling`, `DocumentFilingStatus`, `AttachmentSource`                  |

## Rowboat Current-State Anchors

Implementation agents should inspect the Rowboat side before coding:

| Area                              | Rowboat paths                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Desktop Gmail sync                | `apps/x/packages/core/src/knowledge/sync_gmail.ts`                                                                |
| Desktop Gmail classifier/drafting | `apps/x/packages/core/src/knowledge/classify_thread.ts`                                                           |
| Desktop email UI                  | `apps/x/apps/renderer/src/components/email-view.tsx`                                                              |
| Main-process IPC                  | `apps/x/apps/main/src/ipc.ts`                                                                                     |
| Google OAuth desktop path         | `apps/x/packages/core/src/auth/google-backend-oauth.ts`, `apps/x/packages/core/src/auth/google-client-factory.ts` |
| Broker Google API                 | `apps/rowboat-api/internal/googleapi/gmail.go`, `apps/rowboat-api/internal/googleapi/calendar.go`                 |
| Broker connector tools            | `apps/rowboat-api/internal/backgroundtaskruntime/tools_connectors.go`                                             |
| Cloud events                      | `apps/rowboat-api/ent/schema/cloud_event.go`, `apps/rfc/complete-003-cloud-event-ingestion.md`                             |
| Google watches                    | `apps/rowboat-api/ent/schema/google_watch.go`, `apps/rfc/019-google-push-infrastructure.md`                       |
| Connector/action architecture     | `apps/rfc/012-connector-suite-and-consent-broker.md`, `apps/rfc/020-native-third-party-action-engine.md`          |
| Semantic memory direction         | `apps/rfc/complete-021-semantic-memory-index.md`                                                                           |
| Durable runtime direction         | `apps/rfc/025-desktop-runtime-durability.md`                                                                      |

## Per-RFC Inbox Zero References

### email-001 Provider Foundation

Read:

- `apps/web/utils/email/provider.ts`
- `apps/web/utils/email/types.ts`
- `apps/web/utils/email/provider-types.ts`
- `apps/web/utils/gmail/mail.ts`
- `apps/web/utils/gmail/thread.ts`
- `apps/web/utils/gmail/message.ts`
- `apps/web/utils/gmail/draft.ts`
- `apps/web/utils/gmail/reply.ts`
- `apps/web/utils/gmail/forward.ts`
- `apps/web/utils/gmail/watch.ts`
- `apps/web/utils/gmail/scopes.ts`
- `apps/web/utils/outlook/mail.ts`
- `apps/web/utils/outlook/thread.ts`
- `apps/web/utils/outlook/message.ts`
- `apps/web/utils/outlook/draft.ts`
- `apps/web/utils/outlook/reply.ts`
- `apps/web/utils/outlook/watch.ts`
- `apps/web/utils/outlook/scopes.ts`
- `apps/web/utils/email/watch-manager.ts`

Use for:

- Provider-neutral method shape.
- Gmail/Outlook capability differences.
- Watch/subscription semantics.
- Label/folder abstractions.
- Draft/reply/forward edge cases.

### email-002 Command Center

Read:

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

Use for:

- Product navigation.
- Queue/view taxonomy.
- Thread action affordances.
- Settings and feature entry points.

### email-003 Rules and Action Engine

Read:

- `docs/essentials/email-ai-personal-assistant.mdx`
- `docs/essentials/delayed-actions.mdx`
- `docs/essentials/email-digest.mdx`
- `docs/essentials/call-webhook.mdx`
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

Use for:

- Rule matching order.
- Static + AI + learned pattern conditions.
- Action payloads.
- Delayed-action scheduling.
- Audit records.
- Webhook/digest behavior.

### email-004 Reply Zero and Drafting

Read:

- `docs/essentials/reply-zero.mdx`
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

Use for:

- Thread state classification.
- Nudge generation.
- Draft lifecycle and similarity scoring.
- Learned reply memory.
- Follow-up reminder scheduling.

### email-005 Cleanup and Cold Email

Read:

- `docs/essentials/bulk-archiver.mdx`
- `docs/essentials/bulk-email-unsubscriber.mdx`
- `docs/essentials/cold-email-blocker.mdx`
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

Use for:

- Sender grouping.
- Bulk archive preview/execution.
- Safe unsubscribe parsing.
- Cold-email exclusion rules.
- Cleanup job lifecycle.

### email-006 Digests and Analytics

Read:

- `docs/essentials/email-digest.mdx`
- `docs/essentials/email-analytics.mdx`
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

Use for:

- Digest schedule semantics.
- Digest item summarization limits.
- Stats endpoints and aggregate shapes.
- Response-time calculation.

### email-007 Attachments, Calendar, Channels

Read:

- `docs/essentials/auto-file-attachments.mdx`
- `docs/essentials/calendar-integration.mdx`
- `docs/essentials/slack-integration.mdx`
- `docs/essentials/telegram-integration.mdx`
- `docs/slack/setup.mdx`
- `docs/teams/setup.mdx`
- `docs/telegram/setup.mdx`
- `apps/web/utils/drive/filing-engine.ts`
- `apps/web/utils/drive/document-extraction.ts`
- `apps/web/utils/drive/handle-filing-reply.ts`
- `apps/web/utils/ai/document-filing/analyze-document.ts`
- `apps/web/utils/ai/document-filing/parse-filing-reply.ts`
- `apps/web/utils/calendar/unified-availability.ts`
- `apps/web/utils/ai/calendar/availability.ts`
- `apps/web/utils/messaging/routes.ts`
- `apps/web/utils/messaging/rule-notifications.ts`
- `apps/web/utils/messaging/providers/slack/send.ts`
- `apps/web/utils/messaging/providers/telegram/api.ts`

Use for:

- Attachment filing workflow.
- Destination/folder correction.
- Calendar availability abstraction.
- Channel routing and notification payloads.

### email-008 Platform API

Read:

- `docs/essentials/api-keys.mdx`
- `docs/essentials/call-webhook.mdx`
- `docs/openapi.json`
- `docs/api-reference/endpoint/get-rules.mdx`
- `docs/api-reference/endpoint/post-rules.mdx`
- `docs/api-reference/endpoint/get-statsby-period.mdx`
- `docs/api-reference/endpoint/get-statsresponse-time.mdx`
- `apps/web/app/api/v1/rules/route.ts`
- `apps/web/app/api/v1/rules/[id]/route.ts`
- `apps/web/app/api/v1/stats/by-period/route.ts`
- `apps/web/app/api/v1/stats/response-time/route.ts`
- `apps/web/app/api/user/api-keys/route.ts`
- `apps/web/utils/webhook-action.ts`
- `apps/web/utils/webhook.ts`
- `apps/web/utils/webhook-validation.ts`

Use for:

- API scope vocabulary.
- Public API shape.
- API key handling.
- Signed webhook delivery.

### email-009 Inventory

Read:

- This file.
- `docs/essentials/*.mdx`
- `apps/web/app/(app)/[emailAccountId]/**/page.tsx`
- `apps/web/app/api/**/*.ts`
- `apps/web/prisma/schema.prisma`

Use for:

- Validating that a Rowboat feature has a source reference and a destination RFC.

### email-010 Assistant Chat

Read:

- `docs/essentials/ai-chat.mdx`
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

Use for:

- Tool taxonomy.
- Confirmation flow for mutating chat actions.
- Chat memory and compaction.
- Rule creation through chat.

### email-011 Categories, Tabs, Labels

Read:

- `docs/essentials/inbox-zero-tabs-extension.mdx`
- `docs/essentials/email-ai-personal-assistant.mdx`
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
- `apps/web/app/api/user/categorize/senders/*.ts`

Use for:

- Category taxonomy.
- Gmail-tab query inspiration.
- Provider label sync.
- Sender/category correction flow.

### email-012 Search and Memory

Read:

- `apps/web/utils/ai/knowledge/extract.ts`
- `apps/web/utils/ai/knowledge/extract-from-email-history.ts`
- `apps/web/utils/ai/knowledge/persona.ts`
- `apps/web/utils/ai/knowledge/writing-style.ts`
- `apps/web/utils/actions/knowledge.ts`
- `apps/web/utils/ai/snippets/find-snippets.ts`
- `apps/web/utils/ai/assistant/get-recent-chat-memories.ts`
- `apps/web/utils/ai/assistant/get-inbox-stats-for-chat-context.ts`
- `apps/web/app/api/knowledge/route.ts`
- `apps/web/app/api/user/debug/memories/route.ts`

Use for:

- Knowledge extraction.
- Reply/chat memory retrieval.
- Snippet retrieval for prompts.
- Memory debug surfaces.

### email-013 Meeting Briefs

Read:

- `docs/essentials/meeting-briefs.mdx`
- `apps/web/utils/ai/meeting-briefs/generate-briefing.ts`
- `apps/web/utils/calendar/event-provider.ts`
- `apps/web/utils/calendar/event-types.ts`
- `apps/web/utils/calendar/unified-availability.ts`
- `apps/web/app/api/meeting-briefs/route.ts`
- `apps/web/app/api/user/meeting-briefs/route.ts`
- `apps/web/app/api/user/meeting-briefs/history/route.ts`
- `apps/web/app/(app)/[emailAccountId]/briefs/page.tsx`

Use for:

- Brief timing, status, and content.
- External attendee detection.
- Delivery history.
- Calendar context.

### email-014 Reliability

Read:

- `apps/web/utils/email/rate-limit.ts`
- `apps/web/utils/email/rate-limit-mode-error.ts`
- `apps/web/utils/redis/email-provider-rate-limit.ts`
- `apps/web/utils/gmail/retry.ts`
- `apps/web/utils/outlook/retry.ts`
- `apps/web/utils/email/watch-manager.ts`
- `apps/web/utils/webhook/google/process-history.ts`
- `apps/web/utils/webhook/outlook/process-history.ts`
- `apps/web/utils/webhook/process-history-item.ts`
- `apps/web/utils/webhook/error-handler.ts`
- `apps/web/utils/outlook/subscription-manager.ts`
- `apps/web/utils/outlook/subscription-history.ts`
- `apps/web/utils/schedule.ts`
- `apps/web/utils/scheduled-actions/scheduler.ts`
- `apps/web/utils/scheduled-actions/executor.ts`

Use for:

- Provider retry/backoff behavior.
- Rate-limit state.
- Webhook idempotency.
- Watch/subscription renewal.
- Scheduled action recovery.

### email-015 Privacy and Security

Read:

- `docs/essentials/api-keys.mdx`
- `apps/web/utils/ai/security.ts`
- `apps/web/utils/ai/content-sanitizer.ts`
- `apps/web/utils/ai/assistant/chat-response-guard.ts`
- `apps/web/utils/ai/assistant/chat-context-validation.ts`
- `apps/web/utils/email/render-safe-links.ts`
- `apps/web/utils/email/rewrite-html.ts`
- `apps/web/utils/email/image-proxy-config.ts`
- `apps/web/utils/webhook-validation.ts`
- `apps/web/utils/prisma-extensions.ts`
- `apps/web/utils/braintrust.ts`

Use for:

- Prompt-injection handling.
- HTML/link safety.
- Secret redaction.
- BYO model/API key posture.
- Observability boundaries.

### email-016 Evaluation

Read:

- `apps/web/utils/ai/choose-rule/*.test.ts`
- `apps/web/utils/ai/reply/*.test.ts`
- `apps/web/utils/reply-tracker/*.test.ts`
- `apps/web/utils/cold-email/*.test.ts`
- `apps/web/utils/digest/*.test.ts`
- `apps/web/utils/drive/*.test.ts`
- `apps/web/utils/calendar/**/*.test.ts`
- `apps/web/utils/ai/security.test.ts`
- `apps/web/utils/braintrust.ts`

Use for:

- Test fixture patterns.
- Existing edge cases.
- Quality gates for model behavior.
- Security regression tests.

### email-017 Onboarding and Permissions

Read:

- `apps/web/utils/connect-mailbox.ts`
- `apps/web/utils/actions/email-account.ts`
- `apps/web/utils/actions/email-account.validation.ts`
- `apps/web/utils/gmail/permissions.ts`
- `apps/web/utils/gmail/scopes.ts`
- `apps/web/utils/outlook/scopes.ts`
- `apps/web/utils/oauth/account-linking*.ts`
- `apps/web/app/(app)/[emailAccountId]/setup/page.tsx`
- `apps/web/app/(app)/[emailAccountId]/onboarding/page.tsx`
- `apps/web/app/(app)/[emailAccountId]/permissions/consent/page.tsx`
- `apps/web/app/api/user/setup-progress/route.ts`
- `apps/web/app/api/user/email-account/route.ts`

Use for:

- Account connect flow.
- Progressive permissions.
- Scope validation.
- Setup progress and migration.

### email-018 Roadmap

Read:

- `docs/essentials/*.mdx`
- This file.
- All Rowboat email RFCs.

Use for:

- Sequencing implementation work.
- Avoiding feature-parity scope creep before foundations.

### email-019 Multi-Account and Team Boundaries

Read:

- `apps/web/app/api/user/email-accounts/route.ts`
- `apps/web/app/api/user/settings/multi-account/route.ts`
- `apps/web/app/api/organizations/[organizationId]/stats/totals/route.ts`
- `apps/web/app/api/organizations/[organizationId]/stats/email-buckets/route.ts`
- `apps/web/app/api/organizations/[organizationId]/stats/rules-buckets/route.ts`
- `apps/web/app/api/organizations/[organizationId]/executed-rules-count/route.ts`
- `apps/web/app/(app)/accounts/page.tsx`
- `apps/web/app/(app)/[emailAccountId]/organization/page.tsx`
- `apps/web/app/(app)/organization/[organizationId]/stats/page.tsx`

Use for:

- Account selection.
- Multi-account settings.
- Organization stats boundaries.
- Future team policies.

### email-020 Debug Console

Read:

- `apps/web/app/(app)/[emailAccountId]/debug/page.tsx`
- `apps/web/app/(app)/[emailAccountId]/debug/drafts/page.tsx`
- `apps/web/app/(app)/[emailAccountId]/debug/follow-up/page.tsx`
- `apps/web/app/(app)/[emailAccountId]/debug/memories/page.tsx`
- `apps/web/app/(app)/[emailAccountId]/debug/rule-history/page.tsx`
- `apps/web/app/(app)/[emailAccountId]/debug/rules/page.tsx`
- `apps/web/app/api/user/debug/follow-up/route.ts`
- `apps/web/app/api/user/debug/memories/route.ts`
- `apps/web/app/api/user/debug/rules/route.ts`
- `apps/web/app/api/user/executed-rules/history/route.ts`
- `apps/web/utils/reply-tracker/draft-tracking.ts`
- `apps/web/utils/ai/choose-rule/draft-management.ts`

Use for:

- Operator/debug page taxonomy.
- Draft tracking visibility.
- Rule history inspection.
- Memory inspection.
- Redacted diagnostics design.

### email-021 Implementation Blueprints

Read:

- `apps/rfc/email-001-mailbox-provider-foundation.md`
- `apps/rfc/email-003-ai-rules-and-action-engine.md`
- `apps/rfc/email-004-reply-zero-and-drafting.md`
- `apps/rfc/email-010-ai-mail-assistant-chat.md`
- `apps/rfc/email-014-sync-reliability-rate-limits-and-repair.md`
- `apps/rfc/email-015-email-privacy-security-and-governance.md`
- `apps/rfc/email-016-email-evaluation-and-quality-gates.md`
- Inbox Zero implementation files listed above for the feature being implemented.

Use for:

- Concrete provider adapter shapes.
- Local store and schema starting points.
- IPC command examples.
- Rule engine and action policy code.
- Reply tracker and draft lifecycle code.
- Sync job/backoff code.
- Assistant tool and proposed-action code.
- Eval fixture and quality-gate code.
- Broker handler/provider examples.

## Implementation Translation Rules

### Desktop First

Inbox Zero is a Next.js app with server actions and API routes. Rowboat's first implementation target is the desktop app:

- Prefer `apps/x/packages/core` for local mailbox state, sync, rules, and actions.
- Prefer `apps/x/apps/renderer` for the command center UI.
- Use `apps/rowboat-api` only for brokered OAuth, cloud events, cloud runtime, and cross-device/account features.

### Provider Neutral

Do not implement new product behavior against Gmail-only types unless it is explicitly a compatibility shim. Use the provider-neutral mailbox abstractions from email-001.

### Local First

Inbox Zero stores many features in Postgres. Rowboat should start with local state for:

- Full email bodies.
- Search/semantic index.
- Draft suggestions.
- Learned memories.
- Debug/audit records for local actions.

Sync selected metadata to the broker only when an RFC calls for it.

### Policy Gated

Inbox Zero can execute many actions automatically. Rowboat should gate high-impact actions:

- Send.
- Forward.
- Spam.
- Trash/delete.
- External webhook with body.
- External channel with body.
- Unsubscribe link click.

### Adapt Tests

Do not only inspect production source. Inbox Zero has useful edge-case tests near almost every subsystem. For any implementation, read the matching `*.test.ts` files before coding.
