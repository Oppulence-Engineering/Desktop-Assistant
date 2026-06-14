# RFC email-020: Email Debug Console and Operator Tools

| Field      | Value                                      |
| ---------- | ------------------------------------------ |
| RFC        | email-020                                  |
| Status     | Draft                                      |
| Track      | Desktop email                              |
| Owner      | TBD                                        |
| Created    | 2026-06-12                                 |
| Depends on | email-001, email-003, email-014, email-015 |
| Related    | email-004, email-016, email-018            |

## Summary

Build a first-class debug console for email sync, rules, drafts, memories, provider actions, scheduled actions, and external deliveries. Inbox Zero has debug pages for drafts, follow-up, memories, rules, rule history, and reports. Rowboat should adapt this into a desktop operator console because email automation needs trust and repair tools from the start. The console is not just for engineers; it is how power users understand why Rowboat touched mail.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect:

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

Use these for debug taxonomy and operator workflows. Rowboat should make this a desktop trust surface, not only an internal route collection.

## Goals

- Explain what happened to a thread, rule, draft, sync job, or provider action.
- Provide safe repair controls for sync and automation failures.
- Show audit history in a redacted but useful way.
- Export diagnostics without leaking secrets or raw email by default.
- Support dogfood and support workflows before broad user adoption.

## Non-Goals

- A raw database editor.
- A provider API explorer.
- Exposing secrets or raw OAuth state.
- Letting users bypass action policy.

## Console Sections

### Account Health

- Provider.
- Connected email.
- Capabilities/scopes.
- Auth state.
- Last sync.
- Watch state.
- Cursor state.
- Backoff state.
- Last provider error.

Actions:

- Trigger sync.
- Run bounded repair.
- Renew watch.
- Reconnect.
- Pause/resume account.

### Sync Jobs

- Job ID.
- Type.
- Status.
- Attempts.
- Started/completed.
- Dedupe key.
- Error code.
- Messages fetched/updated.

Actions:

- Retry failed repair.
- Cancel queued job.
- Export job diagnostic.

### Rule History

- Rule version.
- Thread/message.
- Match result.
- Static condition results.
- AI condition result.
- Learned pattern result.
- Planned actions.
- Executed actions.
- User corrections.

Actions:

- Test rule on this thread.
- Disable rule.
- Open rule editor.
- Add correction to eval set.

### Drafts

- Draft suggestions.
- Provider draft IDs.
- Confidence.
- Prompt/model version.
- Source messages.
- Sent comparison.
- Similarity score between generated draft and sent message.
- Stale drafts.

Actions:

- Open draft.
- Delete stale provider draft.
- Mark as useful/not useful.
- Add style memory.

### Reply Tracker

- Needs Reply/Awaiting Reply state.
- Last inbound/outbound IDs.
- Due date.
- Nudge draft status.
- Follow-up notifications.

Actions:

- Mark done.
- Recompute state.
- Cancel nudge.

### Memory and Knowledge

- User-authored knowledge.
- Learned reply memories.
- Chat memories.
- Category/sender memories.
- Source references.

Actions:

- Delete memory.
- Disable learned memory.
- Export memory list.

### External Deliveries

- Webhooks.
- Slack/Telegram notifications.
- Digests.
- Meeting briefs.

Actions:

- Retry.
- Disable destination.
- View payload policy.

## Diagnostic Export

Default export includes:

- App version/build.
- Account/provider hash.
- Capability state.
- Sync health.
- Job/action/rule IDs.
- Error codes.
- Redacted stack traces.
- Feature flags.

Excluded by default:

- Raw email bodies.
- Subjects.
- Recipient lists.
- OAuth tokens.
- API keys.
- Webhook secrets.
- Attachment contents.

User can explicitly include more context for local debugging, but the UI must show what will be included.

## Thread "Why" View

For any thread, the inspector should answer:

- Why is this in this queue?
- Why was this archived/labeled/moved?
- Why is a reply needed?
- Why was this draft created?
- Why is this sender categorized this way?
- Which rules touched this thread?
- What will happen next?

This "why" view should be backed by audit records, not generated from vibes.

## Safety

- Repair actions cannot send email.
- Re-running rules in console defaults to dry-run.
- Retrying provider send requires explicit confirmation and reconciliation.
- Deleting memory/index data should be reversible only if backup exists; warn clearly.

## Test Plan

- Redaction tests for diagnostic export.
- UI tests for empty/error/loading states in each console section.
- Rule history rendering tests.
- Sync repair action tests.
- Draft stale cleanup tests.
- "Why" view tests against known audit fixture.
- Permission tests proving console actions cannot bypass policy.

## Open Questions

- Should debug console be visible by default or hidden behind advanced mode?
- How much raw technical detail should power users see?
- Should diagnostics export integrate with support upload later?
- Which console actions should be disabled in production builds?
