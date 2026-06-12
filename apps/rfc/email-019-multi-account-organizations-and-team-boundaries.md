# RFC email-019: Multi-Account, Organizations, and Team Boundaries

| Field      | Value                                  |
| ---------- | -------------------------------------- |
| RFC        | email-019                              |
| Status     | Draft                                  |
| Track      | Desktop email                          |
| Owner      | TBD                                    |
| Created    | 2026-06-12                             |
| Depends on | email-001, email-008, email-015        |
| Related    | RFC 011, RFC 012, email-010, email-017 |

## Summary

Define how Rowboat email features behave with multiple mailbox accounts and future organization/team contexts. Inbox Zero supports multiple email accounts, organization pages, organization stats, members, and account-scoped settings. Rowboat can start single-user/single-account for dogfood, but the data model and permission checks should not assume that forever. Multi-account mistakes in email are severe: sending from the wrong account, searching the wrong mailbox, or applying a rule to the wrong provider can damage trust immediately.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect:

- `apps/web/prisma/schema.prisma` models `EmailAccount`, `ApiKey`, `Rule`, `ExecutedRule`
- `apps/web/app/api/user/email-accounts/route.ts`
- `apps/web/app/api/user/settings/multi-account/route.ts`
- `apps/web/app/api/organizations/[organizationId]/stats/totals/route.ts`
- `apps/web/app/api/organizations/[organizationId]/stats/email-buckets/route.ts`
- `apps/web/app/api/organizations/[organizationId]/stats/rules-buckets/route.ts`
- `apps/web/app/api/organizations/[organizationId]/executed-rules-count/route.ts`
- `apps/web/app/(app)/accounts/page.tsx`
- `apps/web/app/(app)/[emailAccountId]/organization/page.tsx`
- `apps/web/app/(app)/organization/[organizationId]/stats/page.tsx`

Use these for account scoping and organization-stat boundaries. Rowboat should start account-scoped by default and add cross-account behavior only through explicit UI/API choices.

## Goals

- Support multiple connected mailbox accounts per user.
- Keep rules, categories, drafts, memories, and permissions account-scoped by default.
- Allow explicit cross-account search and summaries.
- Prevent sending or actions from the wrong account.
- Prepare for future organization/team-level policy without building full admin now.
- Make account boundaries visible in UI and API.

## Non-Goals

- Shared team inboxes in the first version.
- Organization-wide analytics by default.
- Delegated access to another user's mailbox.
- Admin approval flows before single-user controls are stable.

## Account Scope Rule

Every email object must carry `accountId`:

- Threads.
- Messages.
- Attachments.
- Rules.
- Categories.
- Sender profiles.
- Draft suggestions.
- Reply trackers.
- Digests.
- Search index docs.
- Memories.
- API keys.
- Webhooks.
- Audit records.

No email mutation should execute without an explicit account ID.

## UI Model

Command center account selector:

- All accounts.
- Individual accounts.
- Account groups.

When "All accounts" is selected:

- Search and read can span accounts.
- Mutations require account-confirmed targets.
- Compose requires explicit From account.
- Rules are shown by account.
- Analytics can aggregate only metadata.

Thread rows must show account identity when more than one account is connected.

## Cross-Account Features

Allowed:

- Unified unread view.
- Unified search.
- Unified digest.
- Unified meeting brief.
- Cross-account sender relationship summary.

Policy-gated:

- Cross-account rules.
- Cross-account cleanup.
- Cross-account learned memory.
- Cross-account assistant answers that include raw body excerpts.

Default: account-local.

## Sending Safety

Before send/reply/forward:

- Use the thread's account as default From.
- Show From account visibly.
- Warn if user changes From to an account not in original thread.
- Re-fetch thread freshness.
- Record account ID in audit.

The assistant cannot infer From account silently when composing a new email across multiple accounts. It must ask or create a draft proposal with missing account state.

## Organization Boundary

Future organization model:

```ts
type MailOrganizationPolicy = {
  organizationId: string;
  allowCloudEmailSummaries: boolean;
  allowExternalWebhooks: boolean;
  allowAutoSend: boolean;
  maxRetentionDays?: number;
  allowedModelProviders: string[];
};
```

Do not implement full org policy yet, but avoid schemas that make it impossible.

## Team Stats

Potential future org stats:

- Aggregate volume.
- Automation impact.
- Shared rule templates.
- Meeting brief adoption.
- Cleanup savings.

Do not include raw subjects, bodies, or personal sender lists by default.

## API Scope

API keys from email-008 can be:

- User-level all permitted accounts.
- Account-scoped.
- Future organization-scoped.

Default to account-scoped for email APIs.

## Test Plan

- Multi-account fixture tests.
- Send-from-account correctness tests.
- Cross-account search permission tests.
- Rule account scoping tests.
- API key account-scope tests.
- UI tests for account labels in all-account view.
- Assistant tests requiring explicit account for new outbound mail.

## Open Questions

- Should dogfood support one account only until the command center is stable?
- Should cross-account learned memory ever be enabled by default?
- How should Rowboat represent aliases and delegated inboxes?
- What is the first team/org email use case worth supporting?
