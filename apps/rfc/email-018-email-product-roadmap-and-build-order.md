# RFC email-018: Email Product Roadmap and Build Order

| Field      | Value                       |
| ---------- | --------------------------- |
| RFC        | email-018                   |
| Status     | Draft                       |
| Track      | Desktop email               |
| Owner      | TBD                         |
| Created    | 2026-06-12                  |
| Depends on | email-009                   |
| Related    | email-001 through email-021 |

## Summary

Define the build order for the Rowboat email track. The expanded RFC set is intentionally broad, but implementation should be staged. The right order is to first make today's Gmail system provider-neutral and reliable, then ship visible desktop value, then add safe AI automation, then grow into cleanup, insights, integrations, APIs, and multi-account/team features.

## Inbox Zero Implementation References

Implementation agents should first read:

- [email-000](./email-000-inbox-zero-agent-reference.md)
- [email-009](./email-009-inbox-zero-source-inventory.md)
- [email-021](./email-021-implementation-blueprints-and-code-examples.md)
- `docs/essentials/*.mdx` in the Inbox Zero repo
- `apps/web/prisma/schema.prisma` in the Inbox Zero repo

Use this RFC to sequence work after comparing Rowboat's current state against Inbox Zero's feature surfaces. Do not treat feature parity as the first milestone; use the milestones below to avoid building integrations before the mailbox foundation and reliability layer are stable.

## Roadmap Principles

- Stabilize current Gmail behavior before adding more background automation.
- Ship visible desktop value early.
- Keep send/forward/spam/destructive actions behind explicit approvals.
- Prefer local-first state until cloud need is proven.
- Build provider-neutral contracts before adding Outlook.
- Add evals before widening autonomous behavior.
- Treat debug/repair tools as core product, not internal afterthoughts.

## Milestone 0: Current Gmail Hardening

RFCs:

- email-014 Sync Reliability, Rate Limits, and Repair.
- email-020 Debug Console.
- email-015 Privacy and Governance baseline.

Deliverables:

- Sync health state.
- Backoff/retry-after behavior.
- Manual repair/backfill.
- Redacted diagnostics.
- Existing Gmail UI unchanged.

Exit criteria:

- No provider hammering after 429/5xx.
- Reconnect and revocation states are explicit.
- Debug console explains last sync/action failures.

## Milestone 1: Mailbox Foundation and Command Center

RFCs:

- email-001 Provider Foundation.
- email-002 Command Center.
- email-017 Onboarding and Permissions.
- email-011 Tabs and Categories basic.

Deliverables:

- `mailbox:*` IPC with Gmail compatibility shims.
- Provider-neutral account/capability state.
- Command center with Important/Other/Unread/Attachments.
- Read, archive, mark read, reply, forward.
- Basic tabs and local categories.

Exit criteria:

- Existing Gmail workflows work through mailbox APIs.
- Renderer no longer depends on Gmail-specific names for product state.
- User can understand connected/missing-scope/reconnect states.

## Milestone 2: Reply Zero and Safe Drafting

RFCs:

- email-004 Reply Zero.
- email-012 Search and Memory.
- email-016 Evaluation.
- email-010 Assistant Chat basic.

Deliverables:

- Needs Reply and Awaiting Reply queues.
- Durable draft suggestions.
- Reply memory/style guide integration.
- Thread summaries and search.
- Assistant can summarize, find, and draft.

Exit criteria:

- No duplicate drafts after repeated sync.
- Draft recipient correctness evals pass.
- User can mark done/awaiting/needs reply.

## Milestone 3: Rules and Low-Risk Automation

RFCs:

- email-003 Rules and Action Engine.
- email-016 Evaluation.
- email-020 Debug Console.

Deliverables:

- Rule CRUD.
- Static conditions.
- Test mode.
- Actions: label, archive, mark read, digest, draft.
- Audit history.
- Scheduled delayed archive/label.

Exit criteria:

- Rules can be tested before enablement.
- All action runs are audited.
- High-impact actions are blocked or approval-gated.

## Milestone 4: Cleanup and Insights

RFCs:

- email-005 Newsletter Cleanup and Cold Email Defense.
- email-006 Digests and Analytics.
- email-011 Smart Categories.

Deliverables:

- Sender profiles.
- Newsletter/cold/notification categories.
- Bulk archive preview.
- Safe unsubscribe.
- Daily/weekly digest.
- Basic analytics.

Exit criteria:

- Cleanup jobs are previewed and reversible where possible.
- Cold email false-positive eval gate passes for monitor/label mode.
- Digest generation does not require full cloud mailbox storage.

## Milestone 5: Calendar, Attachments, and Meeting Briefs

RFCs:

- email-007 Attachments, Calendar, Channels.
- email-013 Meeting Briefs.

Deliverables:

- Local attachment filing.
- Drive connector beta.
- Calendar availability in draft replies.
- Meeting brief view and desktop delivery.
- Slack notification beta.

Exit criteria:

- Briefs are source-labeled.
- Attachments are not sent externally without explicit destination.
- Calendar availability is correct across timezone tests.

## Milestone 6: Ecosystem and Multi-Account

RFCs:

- email-008 Platform API.
- email-010 Assistant Chat channels.
- email-019 Multi-Account and Team Boundaries.

Deliverables:

- Scoped API keys.
- Signed webhooks.
- Import/export rules.
- Multi-account command center.
- Account-scoped policies.
- Slack/Telegram commands where safe.

Exit criteria:

- API scopes enforce least privilege.
- Webhooks are signed and retryable.
- Multi-account search/actions cannot cross accounts accidentally.

## Milestone 7: Outlook

RFCs:

- email-001 Provider Foundation.
- email-014 Reliability.
- email-017 Permissions.
- email-019 Multi-Account.

Deliverables:

- Outlook read.
- Outlook actions.
- Outlook watches.
- Outlook calendar/drive where relevant.

Exit criteria:

- Core command center and low-risk rules work for Gmail and Outlook through the same contracts.

## Workstream Split

| Workstream        | Owns                                       |
| ----------------- | ------------------------------------------ |
| Provider/core     | email-001, email-014, email-017            |
| Desktop UI        | email-002, email-011, email-020            |
| AI/runtime        | email-003, email-004, email-010, email-016 |
| Index/analytics   | email-006, email-012                       |
| Integrations      | email-007, email-013, email-008            |
| Security/platform | email-015, email-019                       |

## Risks

- Broad scope causes unfinished infrastructure. Mitigation: milestone gates.
- AI rules hide important mail. Mitigation: evals, preview, low-risk defaults.
- Provider limits cause flaky sync. Mitigation: email-014 first.
- Users do not trust automation. Mitigation: audit trail and debug console.
- Cloud privacy concerns block adoption. Mitigation: local-first defaults.

## Open Questions

- Should M0 and M1 be one branch or separate branches?
- Should Outlook begin as a parallel workstream after mailbox foundation starts?
- Which milestone is enough for first dogfood announcement?
- Which features should stay behind explicit environment flags?
