# RFC email-017: Onboarding, Permissions, and Feature Adoption

| Field      | Value                                               |
| ---------- | --------------------------------------------------- |
| RFC        | email-017                                           |
| Status     | Draft                                               |
| Track      | Desktop email                                       |
| Owner      | TBD                                                 |
| Created    | 2026-06-12                                          |
| Depends on | email-001, email-002, email-015                     |
| Related    | RFC 012, email-003, email-004, email-005, email-007 |

## Summary

Define the onboarding and permissions flow for Rowboat email features. Inbox Zero has setup, onboarding, permission consent, account linking, feature pages, and settings for automation, calendars, drives, channels, digests, reply tracking, and cleanup. Rowboat needs a desktop-first version that earns trust progressively: connect mailbox, sync read-only context, request additional scopes only when the user enables actions, explain what each feature can do, and show feature health after setup.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect:

- `apps/web/utils/connect-mailbox.ts`
- `apps/web/utils/actions/email-account.ts`
- `apps/web/utils/actions/email-account.validation.ts`
- `apps/web/utils/gmail/permissions.ts`
- `apps/web/utils/gmail/scopes.ts`
- `apps/web/utils/outlook/scopes.ts`
- `apps/web/utils/oauth/account-linking.test.ts`
- `apps/web/utils/oauth/account-linking-redirect.test.ts`
- `apps/web/app/(app)/[emailAccountId]/setup/page.tsx`
- `apps/web/app/(app)/[emailAccountId]/onboarding/page.tsx`
- `apps/web/app/(app)/[emailAccountId]/permissions/consent/page.tsx`
- `apps/web/app/api/user/setup-progress/route.ts`
- `apps/web/app/api/user/email-account/route.ts`

Use these for account linking, provider permission checks, setup progress, and consent UX. Rowboat should translate this into desktop feature adoption cards and broker OAuth scope upgrades.

## Goals

- Make email setup understandable and reversible.
- Request least-privilege scopes by feature and capability.
- Convert current Gmail setup into provider-neutral mailbox onboarding.
- Let users adopt features incrementally instead of accepting a huge permission bundle.
- Show health, missing scopes, and reconnect state clearly.
- Support migration from existing Gmail sync users.

## Non-Goals

- Growth-oriented onboarding funnels.
- Enterprise admin approval flows in the first version.
- Asking for all future scopes upfront.

## Onboarding Stages

### Stage 1: Connect Mailbox

Capabilities:

- Mail read.
- Account identity.
- Basic labels/folders.

User outcome:

- See inbox in command center.
- Search/read threads.
- Get local summaries if enabled.

### Stage 2: Enable Mail Actions

Capabilities:

- Archive.
- Mark read.
- Label/move.
- Draft.

User outcome:

- Use toolbar actions.
- Allow safe rules like label/archive.

### Stage 3: Enable Sending

Capabilities:

- Send/reply/forward.

User outcome:

- Send from Rowboat.
- Create provider drafts.
- AI draft suggestions can be sent after review.

### Stage 4: Enable Automation

Capabilities:

- Rule engine.
- Scheduled actions.
- Audit history.

User outcome:

- Create rules.
- Test rules.
- Enable low-risk automation.

### Stage 5: Connect Adjacent Services

Capabilities:

- Calendar.
- Drive/OneDrive.
- Slack/Telegram.
- Webhooks/API keys.

User outcome:

- Meeting briefs.
- Attachment filing.
- Notifications.
- External integrations.

## Permission Copy Requirements

For every scope request, show:

- What Rowboat will be able to do.
- Which features need it.
- Whether actions are automatic or require approval.
- Whether data stays local or can go to cloud.
- How to revoke.

Example:

```text
Allow Rowboat to modify mail?

Needed for: archive, label, move, mark read, cleanup rules.
Not included: sending email.
Default automation: safe actions only, visible in audit history.
You can revoke this from Settings -> Email -> Account.
```

## Feature Adoption Cards

The command center should show setup cards only when relevant:

- Reply Zero: "Track conversations that need replies."
- Cleanup: "Find newsletters and noisy senders."
- Rules: "Automate low-risk mail handling."
- Digests: "Collect lower-priority messages."
- Calendar: "Use availability in drafts and meeting briefs."
- Attachments: "File email attachments."
- Channels: "Send notifications to Slack/Telegram."

Each card should have:

- Benefit.
- Required permissions.
- Data boundary.
- Preview/test option.
- Enable toggle.

## Migration From Existing Gmail Sync

Existing users may already have Gmail modify scope and local caches.

Migration path:

1. Detect Gmail connection.
2. Create `MailboxAccount` record.
3. Import sync cursor/account email.
4. Preserve current local cache.
5. Enable command center in Gmail compatibility mode.
6. Show "Mail actions already enabled" based on existing scope.
7. Ask only for missing scopes when new features require them.

## Reconnect and Revocation

States:

- Connected.
- Missing scope.
- Token expired/reconnect required.
- Provider revoked.
- Feature paused.
- Account removed.

Revocation should:

- Stop sync and automation.
- Preserve local data unless user asks to delete it.
- Mark feature cards disabled.
- Keep audit history.

## Onboarding Analytics

Local/product metrics:

- Connected mailbox.
- First successful sync.
- First archive/read action.
- First draft.
- First rule test.
- First rule enabled.
- First cleanup job.
- First digest.
- First reconnect.

Do not log email bodies, subjects, or raw addresses.

## Test Plan

- Scope/capability matrix tests.
- Migration tests from existing Gmail state.
- UI tests for each account state.
- Reconnect/revocation tests.
- Feature card gating tests.
- Consent copy snapshot tests.
- Manual test: connect read-only, enable actions, revoke provider, reconnect.

## Open Questions

- Should Gmail continue requesting broad `gmail.modify` during migration, or split scopes immediately?
- Should automation onboarding require a successful rule test before enabling a rule?
- Should local-only users be able to skip broker sign-in for email features?
- How much onboarding belongs in the command center versus settings?
