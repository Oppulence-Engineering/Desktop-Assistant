# RFC email-013: Meeting Briefs and Relationship Context

| Field      | Value                                      |
| ---------- | ------------------------------------------ |
| RFC        | email-013                                  |
| Status     | Draft                                      |
| Track      | Desktop email                              |
| Owner      | TBD                                        |
| Created    | 2026-06-12                                 |
| Depends on | email-001, email-004, email-007, email-012 |
| Related    | email-006, email-010, email-015            |

## Summary

Add meeting briefs generated from email history, calendar context, previous meetings, and user knowledge. Inbox Zero's Meeting Briefs feature sends AI-generated briefings before meetings with external contacts, including attendee profiles, recent email history, past meetings, and optional web research, delivered by email or Slack. Rowboat should adapt this into a desktop-first relationship context system that also feeds reply drafting and the command center.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect:

- `docs/essentials/meeting-briefs.mdx`
- `apps/web/prisma/schema.prisma` models `MeetingBriefing`, `CalendarConnection`, `Calendar`, `BookingLink`
- `apps/web/utils/ai/meeting-briefs/generate-briefing.ts`
- `apps/web/utils/calendar/event-provider.ts`
- `apps/web/utils/calendar/event-types.ts`
- `apps/web/utils/calendar/unified-availability.ts`
- `apps/web/app/api/meeting-briefs/route.ts`
- `apps/web/app/api/user/meeting-briefs/route.ts`
- `apps/web/app/api/user/meeting-briefs/history/route.ts`
- `apps/web/app/(app)/[emailAccountId]/briefs/page.tsx`

Use these for brief timing, status transitions, external attendee handling, and delivery history. Rowboat should start with desktop delivery and source-labeled local context.

## Goals

- Generate concise briefings before meetings with external attendees.
- Summarize recent email history and prior meeting context per attendee.
- Skip internal-only meetings by default.
- Support configurable timing and delivery channels.
- Expose relationship context in thread reader and assistant chat.
- Keep web research optional and source-labeled.

## Non-Goals

- Replacing the user's calendar app.
- Building a full CRM.
- Sending briefs externally without user consent.
- Running web research by default on every attendee.

## Meeting Brief Model

```ts
type MeetingBrief = {
  id: string;
  accountId: string;
  calendarEventId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: "pending" | "sent" | "skipped" | "failed";
  skipReason?: string;
  deliveryChannels: ("desktop" | "email" | "slack" | "telegram")[];
  generatedAt?: string;
  sentAt?: string;
  contentRef?: string;
};
```

```ts
type AttendeeBrief = {
  attendeeEmail: string;
  attendeeName?: string;
  isInternal: boolean;
  recentThreadIds: string[];
  priorMeetingIds: string[];
  relationshipSummary?: string;
  talkingPoints: string[];
  openQuestions: string[];
  risksOrSensitiveTopics: string[];
  sources: BriefSource[];
};
```

## Brief Generation Pipeline

1. Poll or receive calendar event changes.
2. Identify meetings within the configured lookahead window.
3. Skip internal-only events unless user overrides.
4. Resolve external attendees.
5. Search recent email threads with each attendee/domain.
6. Search prior calendar events with the same attendees.
7. Retrieve user-authored knowledge and relationship memory.
8. Optionally run web research if enabled.
9. Generate brief with citations/source references.
10. Deliver through selected channels.
11. Record status and delivery result.

## Timing

User settings:

- Enable/disable meeting briefs.
- Lead time from 1 minute to 48 hours.
- Work-hours-only delivery.
- Skip declined/cancelled events.
- Skip internal-only events.
- Delivery channels.

The default should be desktop notification plus command center brief, not email delivery, because Rowboat is desktop-first. Email/Slack delivery can be enabled.

## Relationship Context

Meeting briefs should produce reusable relationship context:

- Attendee profile.
- Recent email summary.
- Open threads.
- Outstanding asks.
- Past commitments.
- Preferred tone.
- Known organization/company.

This context should appear in:

- Meeting brief view.
- Mail thread inspector.
- Reply drafting.
- Assistant chat.
- Search results for the person/domain.

## Source Policy

Brief content should distinguish:

- Email history.
- Calendar history.
- User-authored notes.
- Learned memory.
- Web research.
- Inference.

The UI should not present web research as confirmed internal knowledge. Each section should have source labels.

## Delivery

Desktop:

- Upcoming briefs list.
- Brief detail view.
- Send test brief.
- Regenerate.
- Mark useful/not useful.

Email:

- Optional send-to-self.
- Include link back to Rowboat.
- Avoid including sensitive raw excerpts.

Slack/Telegram:

- Summary only by default.
- Link to full brief.
- Respect channel payload policy from email-007.

## Failure Handling

Statuses:

- `pending`: waiting for generation or delivery.
- `sent`: delivered.
- `skipped`: no external attendees, disabled, cancelled, or too soon.
- `failed`: generation or delivery failed.

Failures should be visible in the debug console and not retry forever.

## Privacy

- Brief generation uses local email index by default.
- Web research is opt-in and source-labeled.
- Do not send raw email bodies to external channels by default.
- Do not include internal-only attendee profiles unless enabled.
- Respect "never index" and "never brief" sender/domain settings.

## Migration Plan

1. Add calendar event index and external-attendee detection.
2. Add upcoming meeting brief list in command center.
3. Generate local-only brief from email summaries and calendar event metadata.
4. Add desktop notification and manual test brief.
5. Add email delivery.
6. Add Slack delivery.
7. Add optional web research and relationship memory feedback.

## Test Plan

- Calendar event classification tests for internal/external meetings.
- Time-window tests for lead time and cancelled events.
- Retrieval tests for attendee email history.
- Source-label tests.
- Delivery tests for desktop/email/channel paths.
- Privacy tests proving raw thread bodies are not included in external notifications by default.
- Manual test: upcoming external meeting -> generated brief -> delivery -> history visible.

## Open Questions

- Should meeting briefs be generated by desktop only, broker only, or either depending on availability?
- How should Rowboat identify "internal" domains for users with multiple accounts?
- Should web research be disabled until source/citation UI is complete?
- Should brief feedback update relationship memory automatically or require confirmation?
