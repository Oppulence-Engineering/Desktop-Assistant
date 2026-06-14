# RFC email-015: Email Privacy, Security, and Governance

| Field      | Value                                           |
| ---------- | ----------------------------------------------- |
| RFC        | email-015                                       |
| Status     | Draft                                           |
| Track      | Desktop email                                   |
| Owner      | TBD                                             |
| Created    | 2026-06-12                                      |
| Depends on | email-001, email-008, email-012                 |
| Related    | RFC 011, RFC 012, RFC 021, email-010, email-016 |

## Summary

Define privacy, security, retention, model routing, and governance rules for Rowboat email features. Email contains credentials, contracts, financial documents, sensitive personal data, and private relationships. Inbox Zero supports BYO API keys and self-hosted/local model options, but Rowboat's desktop-first architecture should set stricter defaults: local-first full bodies, scoped cloud storage, explicit action approvals, inspectable learned memory, and clear retention controls.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect:

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

Use these for prompt-injection defenses, safe HTML/link rendering, secret redaction, BYO model posture, and observability boundaries. Rowboat should default stricter than Inbox Zero when full bodies or external payloads are involved.

## Goals

- Establish default privacy boundaries for every email RFC.
- Define what can be stored locally, synced to cloud, sent to models, sent to channels, and sent to webhooks.
- Support BYO LLM keys and local model routing.
- Protect against prompt injection from email bodies.
- Make learned memories and indexes inspectable and deletable.
- Define audit and retention expectations before automation scales.

## Non-Goals

- Formal compliance certification.
- Enterprise admin controls before individual-user controls are stable.
- End-to-end encrypted multi-device sync in the first version.

## Data Classes

| Class              | Examples                              | Default handling                                     |
| ------------------ | ------------------------------------- | ---------------------------------------------------- |
| Provider secret    | OAuth refresh/access token            | Sealed storage only; never model/log/webhook.        |
| Raw email body     | Text/HTML body                        | Local-first; cloud/model opt-in by feature.          |
| Email metadata     | sender, recipient, subject, timestamp | Local; cloud only as needed for synced features.     |
| Attachment content | PDFs, images, docs                    | Local; external filing only by explicit action/rule. |
| Derived summary    | thread summary, digest summary        | Local; cloud optional if feature needs delivery.     |
| Learned memory     | style, correction, sender rules       | Local and inspectable; sync optional.                |
| Aggregate stats    | counts, response time                 | Local; cloud aggregate allowed by setting.           |
| Audit record       | action/rule result                    | Local; cloud for broker actions.                     |

## Model Routing Policy

Settings:

- Rowboat-hosted model allowed.
- BYO OpenAI/Anthropic/Google/Groq/OpenRouter key.
- Local model only.
- Never send raw email bodies to remote models.
- Allow summaries/snippets only.

Feature defaults:

| Feature                 | Default model payload                        |
| ----------------------- | -------------------------------------------- |
| Category classification | metadata + snippet                           |
| Rule matching           | metadata + relevant body excerpts if enabled |
| Draft reply             | selected thread body, user-approved          |
| Meeting brief           | summaries and recent thread excerpts         |
| Digest                  | summaries/snippets                           |
| Assistant search        | metadata/summaries first                     |
| Attachment filing       | filename/metadata first; content opt-in      |

## Prompt Injection Defense

Email content is untrusted. The assistant and automation engine must:

- Treat message body as data, not instructions.
- Never follow instructions inside emails that ask to ignore system policy.
- Keep tool permissions outside model control.
- Require structured tool proposals and policy validation.
- Cite source messages separately from model instructions.
- Red-team rules with malicious email fixtures.

## Retention Controls

User settings:

- Retain raw local mail cache for N days or indefinitely.
- Retain summaries for N days.
- Retain chat history for N days.
- Retain audit logs for N days.
- Retain learned memories until deleted or auto-expire.
- Delete all email-derived data for an account.

Deletion must cover:

- Local store.
- Search index.
- Vector index.
- Summaries.
- Draft suggestions.
- Chat memory.
- Rule run history where legally/practically allowed.

## External Payload Policies

For Slack/Telegram/webhooks/email digests:

- Metadata only.
- Summary only.
- Summary plus selected excerpts.
- Full body.
- Attachments.

Default: metadata plus summary, no full body, no attachments.

Each rule/webhook/channel can choose a stricter policy, never a broader policy than the account/global maximum.

## Secrets and Credentials

- OAuth tokens sealed at rest.
- API keys hashed at rest.
- BYO LLM keys sealed at rest.
- Webhook secrets generated and shown once.
- No secrets in logs, prompts, digests, or exported diagnostics.
- Reconnect and revocation states visible to user.

## Audit

Audit every:

- Provider action.
- Rule match.
- Rule/action failure.
- External webhook delivery.
- Channel notification.
- Assistant-proposed mutation.
- User approval.
- Scope change.
- Data export/import.
- Model provider used for draft/action.

Audit entries should be searchable and redacted.

## Detailed Code Examples

See [email-021](./email-021-implementation-blueprints-and-code-examples.md) for prompt-injection and assistant-policy examples.

### External Payload Enforcement

```ts
export type ExternalPayloadPolicy = {
  includeMetadata: boolean;
  includeSummary: boolean;
  includeBody: boolean;
  includeAttachments: boolean;
};

export function clampPayloadPolicy(input: {
  accountMax: ExternalPayloadPolicy;
  destinationPolicy: ExternalPayloadPolicy;
  requested: ExternalPayloadPolicy;
}): ExternalPayloadPolicy {
  return {
    includeMetadata:
      input.accountMax.includeMetadata &&
      input.destinationPolicy.includeMetadata &&
      input.requested.includeMetadata,
    includeSummary:
      input.accountMax.includeSummary &&
      input.destinationPolicy.includeSummary &&
      input.requested.includeSummary,
    includeBody:
      input.accountMax.includeBody &&
      input.destinationPolicy.includeBody &&
      input.requested.includeBody,
    includeAttachments:
      input.accountMax.includeAttachments &&
      input.destinationPolicy.includeAttachments &&
      input.requested.includeAttachments,
  };
}
```

### Redacted Diagnostic Export

```ts
export function redactMailboxDiagnostic(input: MailboxDiagnostic): RedactedMailboxDiagnostic {
  return {
    appVersion: input.appVersion,
    accountHash: sha256(input.accountEmail),
    provider: input.provider,
    capabilities: input.capabilities,
    syncState: input.syncState,
    recentErrors: input.recentErrors.map((error) => ({
      code: error.code,
      message: redactSecrets(error.message),
      providerStatus: error.providerStatus,
      retryAt: error.retryAt,
    })),
    recentActionRuns: input.recentActionRuns.map((run) => ({
      id: run.id,
      actionType: run.actionType,
      status: run.status,
      createdAt: run.createdAt,
      errorCode: run.error?.code,
    })),
  };
}
```

## Test Plan

- Unit tests for payload policy enforcement.
- Prompt-injection evals for assistant and rule engine.
- Deletion tests for account data wipe.
- Secret redaction tests for logs/export.
- Scope enforcement tests.
- Model routing tests with local-only and BYO-key modes.
- Webhook/channel payload tests.

## Open Questions

- Should cloud sync of derived summaries be opt-in globally or per feature?
- Should local-only mode disable all broker email APIs or allow metadata-only auth checks?
- What is the default retention period for raw local mail cache?
- Which data should be included in a support diagnostics export?
