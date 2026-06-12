# RFC email-007: Attachments, Calendar Context, and Messaging Channels

| Field      | Value                                           |
| ---------- | ----------------------------------------------- |
| RFC        | email-007                                       |
| Status     | Draft                                           |
| Track      | Desktop email                                   |
| Owner      | TBD                                             |
| Created    | 2026-06-12                                      |
| Depends on | email-001, email-002, email-003                 |
| Related    | RFC 012, RFC 019, RFC 020, email-004, email-006 |

## Summary

Extend email workflows with attachment filing, calendar-aware replies, booking links, and messaging-channel notifications/commands. Inbox Zero connects these features tightly to email: attachments can be auto-filed to Drive/OneDrive, calendar availability can shape draft replies and booking links, and Slack/Telegram can notify the user or act as an assistant interface. Rowboat already has Gmail attachment extraction, Google Calendar read access in the broker, and cloud event infrastructure, but these pieces are not unified into desktop email workflows.

This RFC defines an attachment filing workflow, calendar context interface, booking-link primitive, and messaging channel bridge for email automation.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect:

- `docs/essentials/auto-file-attachments.mdx`
- `docs/essentials/calendar-integration.mdx`
- `docs/essentials/slack-integration.mdx`
- `docs/essentials/telegram-integration.mdx`
- `docs/slack/setup.mdx`
- `docs/teams/setup.mdx`
- `docs/telegram/setup.mdx`
- `apps/web/prisma/schema.prisma` models `DriveConnection`, `FilingFolder`, `DocumentFiling`, `AttachmentSource`, `CalendarConnection`, `Calendar`, `BookingLink`, `Booking`, `MessagingChannel`, `MessagingRoute`
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

Adapt integrations through Rowboat's connector and consent model. Local attachment filing should precede cloud-drive filing.

## Source Analysis

| Source fact                                                                                                                               | Evidence                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inbox Zero can file attachments into Google Drive or OneDrive, match folders with AI, ask/correct by reply, and send Slack notifications. | `inbox-zero/docs/essentials/auto-file-attachments.mdx`, `inbox-zero/apps/web/prisma/schema.prisma` `DriveConnection`, `FilingFolder`, `DocumentFiling`                                     |
| Inbox Zero calendar integration connects Google/Outlook calendars for availability-aware draft replies and booking links.                 | `inbox-zero/docs/essentials/calendar-integration.mdx`, `inbox-zero/apps/web/prisma/schema.prisma` `CalendarConnection`, `BookingLink`, `MeetingBriefing`                                   |
| Inbox Zero Slack/Telegram integrations support notifications, meeting briefs, auto-filing notifications, assistant chat, and commands.    | `inbox-zero/docs/essentials/slack-integration.mdx`, `inbox-zero/docs/essentials/telegram-integration.mdx`, `inbox-zero/apps/web/prisma/schema.prisma` `MessagingChannel`, `MessagingRoute` |
| Rowboat desktop already downloads Gmail attachments and rewrites inline image references for local rendering.                             | `apps/x/packages/core/src/knowledge/sync_gmail.ts`                                                                                                                                         |
| Rowboat broker has Google Calendar read tools and Google watch infrastructure.                                                            | `apps/rowboat-api/internal/googleapi/calendar.go`, `apps/rowboat-api/internal/backgroundtaskruntime/tools_connectors.go`, `apps/rfc/019-google-push-infrastructure.md`                     |

## Goals

- Let users file email attachments into local folders first, then cloud drives when connected.
- Use AI to recommend filing destinations based on folder descriptions and message context.
- Let users correct filing decisions and improve future matches.
- Include calendar availability in reply drafting and scheduling workflows.
- Provide email-triggered notifications and command surfaces through Slack/Telegram later.
- Keep all external delivery explicit and auditable.

## Non-Goals

- Building a full document management system.
- Building a full scheduling product.
- Replacing Slack, Telegram, or calendar clients.
- Sending attachment contents to external channels by default.

## Attachment Filing

### Filing Destination

```ts
type FilingDestination = {
  id: string;
  accountId: string;
  kind: "local_folder" | "google_drive" | "onedrive";
  displayName: string;
  description?: string;
  providerFolderId?: string;
  localPath?: string;
  enabled: boolean;
};
```

### Filing Record

```ts
type AttachmentFiling = {
  id: string;
  accountId: string;
  messageId: string;
  attachmentId: string;
  destinationId: string;
  status: "suggested" | "approved" | "filed" | "failed" | "ignored";
  confidence: number;
  reason?: string;
  outputPath?: string;
  providerFileId?: string;
  correctedDestinationId?: string;
  createdAt: string;
  completedAt?: string;
};
```

### Filing Pipeline

1. Detect file attachments during mailbox sync.
2. Extract safe metadata: filename, MIME type, size, sender, subject, snippet.
3. Optionally inspect text content for supported formats when local extraction is available.
4. Score filing destinations using folder descriptions and message context.
5. Suggest filing in the thread inspector or cleanup queue.
6. File automatically only for trusted rules or high-confidence destinations approved by the user.
7. Record correction when user moves/overrides destination.

Local folder filing should ship first because it fits Rowboat desktop. Drive/OneDrive can reuse connector consent patterns from RFC 012.

## Calendar Context

Define a calendar context service used by drafting and automation:

```ts
type CalendarAvailabilityRequest = {
  accountId: string;
  startDate: string;
  endDate: string;
  durationMinutes: number;
  timezone: string;
  workingHoursOnly: boolean;
};

type CalendarAvailabilitySlot = {
  start: string;
  end: string;
  calendarIds: string[];
};
```

Drafting use cases:

- "I am free Tuesday afternoon or Thursday morning."
- "Here is a booking link."
- "I cannot make that time; suggest alternatives."
- "Summarize meeting context before replying."

The reply engine from email-004 should request calendar context through this service rather than calling Google Calendar directly.

## Booking Links

Minimal booking link primitive:

```ts
type BookingLink = {
  id: string;
  userId: string;
  title: string;
  durationMinutes: number;
  timezone: string;
  calendarIds: string[];
  availabilityPolicy: Record<string, unknown>;
  active: boolean;
  publicUrl?: string;
};
```

First version can generate a local or broker URL that displays available slots and creates calendar events after confirmation.

Booking links are optional; availability-aware drafting can ship first.

## Messaging Channels

Channel model:

```ts
type MessagingChannel = {
  id: string;
  userId: string;
  provider: "slack" | "telegram";
  externalUserId: string;
  externalChannelId?: string;
  status: "active" | "paused" | "revoked";
  defaultRoutes: MessagingRoute[];
};
```

Email-triggered notifications:

- New important email.
- Needs reply overdue.
- Awaiting reply overdue.
- Attachment filed.
- Rule action failed.
- Digest ready.
- Meeting brief ready.

Assistant commands:

- Search inbox.
- Summarize unread.
- Draft reply.
- Follow-ups.
- Cleanup.
- Enable/disable rule.

Mutating commands must enforce the same approval and audit policy as desktop actions.

## UI Requirements

Attachment panel:

- Files in current thread.
- Filing suggestions.
- Destination picker.
- Status and errors.
- "Always file this sender/type here" rule creation.

Calendar panel:

- Connected calendars.
- Availability summary.
- Booking link selector.
- Insert availability into draft.

Channels panel:

- Connected channels.
- Notification routes.
- Recent notifications.
- Command permissions.

## Security and Privacy

- Attachment contents stay local unless user selects cloud destination.
- Do not post attachment contents to messaging channels by default.
- Channel notifications should use summaries and links, not full raw messages.
- Calendar availability should expose free/busy slots, not full event details, unless user opts in.
- Booking links must validate ownership and prevent arbitrary calendar creation.
- External channel commands require signed callback verification.

## Migration Plan

1. Surface current Gmail attachment cache in the command center inspector.
2. Add local filing destinations and manual filing.
3. Add AI destination suggestions and correction memory.
4. Add Google Drive connector behind feature flag.
5. Add calendar context service for draft generation.
6. Add booking links.
7. Add Slack notifications for digest/action failure/attachment filed.
8. Add Telegram or Slack assistant commands after notification routes are stable.

## Test Plan

- Unit tests for destination scoring.
- Attachment filing tests for local paths, duplicate filenames, and retry behavior.
- Privacy tests proving channel notifications omit body/attachment content by default.
- Calendar availability tests with overlapping events and timezones.
- Booking link tests for slot reservation and event creation.
- Channel webhook signature tests.
- Manual test: receive attachment, file locally, correct destination, generate reply with calendar availability.

## Open Questions

- Should local file destinations be workspace-relative or arbitrary user-selected folders?
- Which cloud drive should ship first: Google Drive because Gmail is first, or OneDrive because Outlook is next?
- Should booking links be broker-hosted only, or can the desktop app host temporary links?
- Which messaging channel should be the first supported notification target?
