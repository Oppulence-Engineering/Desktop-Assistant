# RFC email-014: Sync Reliability, Rate Limits, and Repair

| Field      | Value                                |
| ---------- | ------------------------------------ |
| RFC        | email-014                            |
| Status     | Draft                                |
| Track      | Desktop email                        |
| Owner      | TBD                                  |
| Created    | 2026-06-12                           |
| Depends on | email-001                            |
| Related    | RFC 003, RFC 019, RFC 025, email-020 |

## Summary

Make mailbox sync and automation reliable under provider rate limits, webhook duplication, cursor loss, auth failures, crashes, and multi-device concurrency. Inbox Zero has provider webhooks, history processing, Outlook locks, schedule drift tests, cron fallbacks, and debug pages. Rowboat's Gmail desktop sync works today, but the email track needs durability before adding more automation.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect:

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

Use these for provider retry/backoff, webhook idempotency, subscription renewal, and scheduled-action recovery. Rowboat should combine those lessons with RFC 025 durable local queues.

## Goals

- Prevent sync loops from hammering providers after transient failures.
- Make incremental sync idempotent and repairable.
- Handle provider watch expiration and cursor invalidation.
- Support local durable job state instead of only in-memory guards.
- Surface sync health clearly in the command center and debug console.
- Provide manual repair tools that do not require deleting local state.

## Non-Goals

- Perfect exactly-once processing across all providers.
- Full provider outage abstraction.
- Rebuilding the entire desktop runtime queue in this RFC.

## Failure Modes

| Failure                       | Required behavior                                            |
| ----------------------------- | ------------------------------------------------------------ |
| Provider 429                  | Honor retry-after, back off, preserve tokens/state.          |
| Provider 5xx/network          | Backoff with jitter, no destructive state writes.            |
| Auth reconnect required       | Quiesce sync, show reconnect, no infinite retry.             |
| Watch expired                 | Renew if token valid, else reconnect-required.               |
| Cursor invalid                | Start bounded repair/backfill.                               |
| Duplicate webhook             | Deduplicate by provider event/cursor/message ID.             |
| Desktop crash mid-sync        | Resume from last committed cursor.                           |
| Message deleted externally    | Tombstone or remove from local index.                        |
| Provider action response lost | Reconcile provider state before retrying destructive action. |

## Sync State Model

```ts
type MailboxSyncState = {
  accountId: string;
  provider: "gmail" | "outlook";
  mode: "idle" | "syncing" | "backoff" | "repairing" | "paused" | "needs_reconnect";
  lastSuccessfulSyncAt?: string;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  lastCursor?: string;
  cursorHealth: "valid" | "unknown" | "invalid";
  watchExpiresAt?: string;
  consecutiveFailures: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
};
```

## Job Model

Use the durable runtime direction from RFC 025:

```ts
type MailboxJob = {
  id: string;
  accountId: string;
  type: "initial_backfill" | "incremental_sync" | "repair" | "watch_renewal" | "provider_action";
  status: "queued" | "running" | "backoff" | "succeeded" | "failed" | "cancelled";
  dedupeKey: string;
  attempt: number;
  availableAt: string;
  lockedUntil?: string;
  payload: Record<string, unknown>;
};
```

## Backoff Policy

- Honor provider retry-after when present.
- Apply exponential backoff with jitter.
- Cap background sync backoff at 15 minutes.
- Cap user-initiated action retry at shorter windows and surface failure.
- Store backoff state durably per account and job.
- Never run multiple incremental sync jobs for the same account concurrently.

## Cursor Repair

When history cursor is invalid:

1. Mark cursor health invalid.
2. Pause incremental sync.
3. Run bounded recent backfill, e.g. last 30 days or configured window.
4. Reconcile changed/deleted messages.
5. Establish new cursor from provider.
6. Mark cursor valid.
7. Resume incremental sync.

If repair fails repeatedly, show explicit action in debug console.

## Provider Action Reconciliation

For archive, label, send, draft, move, and mark read:

- Persist intended action before provider call.
- Execute provider call with idempotency key where provider supports it.
- On ambiguous failure, fetch target state before retry.
- Mark action succeeded if provider state already reflects intended outcome.
- Avoid retrying send without a provider/idempotency check.

## Observability

Metrics:

- Sync duration.
- Messages fetched.
- Cursor invalidations.
- Watch renewal success/failure.
- Provider 429/5xx counts.
- Backoff active count.
- Action reconciliation count.
- Duplicate event suppression count.

Logs should include account ID hash/provider/job ID/error code, not email bodies or raw addresses unless scrubbed.

## Detailed Code Examples

See [email-021](./email-021-implementation-blueprints-and-code-examples.md) for full sync job and backoff examples.

### Repair Trigger

```ts
export async function handleCursorInvalid(input: {
  accountId: string;
  store: MailboxStore;
  jobs: MailboxJobQueue;
  reason: string;
}): Promise<void> {
  await input.store.updateSyncState(input.accountId, {
    mode: "repairing",
    cursorHealth: "invalid",
    lastError: {
      code: "cursor_invalid",
      message: input.reason,
    },
  });

  await input.jobs.enqueueUnique({
    accountId: input.accountId,
    type: "repair",
    dedupeKey: `mailbox:${input.accountId}:repair`,
    availableAt: Date.now(),
    payload: {
      reason: input.reason,
      backfillDays: 30,
    },
  });
}
```

### Ambiguous Provider Action Reconciliation

```ts
export async function reconcileArchiveAfterAmbiguousFailure(input: {
  account: MailboxAccount;
  provider: MailboxProvider;
  thread: MailboxThread;
  actionRunId: string;
  audit: MailboxAuditLog;
}): Promise<void> {
  const fresh = await input.provider.getThread({
    accountId: input.account.id,
    provider: input.account.provider,
    providerThreadId: input.thread.providerThreadId,
  });

  const alreadyArchived = !fresh.folderIds.includes("INBOX") && !fresh.labels.includes("INBOX");
  if (alreadyArchived) {
    await input.audit.markActionSucceeded(input.actionRunId, {
      reconciled: true,
      reason: "Provider state already reflects archive action",
    });
    return;
  }

  await input.audit.markActionFailed(input.actionRunId, {
    code: "ambiguous_provider_failure",
    message: "Archive may not have applied; provider state does not confirm success.",
  });
}
```

## UI Requirements

Command center status:

- Last synced.
- Sync in progress.
- Backoff until time.
- Needs reconnect.
- Repair running.
- Watch expiring/expired.

Debug console:

- Recent sync jobs.
- Recent provider errors.
- Cursor state.
- Watch state.
- Manual repair/backfill.
- Export redacted diagnostics.

## Test Plan

- Fake provider tests for 429 retry-after and 5xx backoff.
- Cursor invalidation repair tests.
- Duplicate webhook/event tests.
- Crash/resume tests for queued jobs.
- Provider action reconciliation tests, especially send/draft.
- Watch renewal tests.
- UI tests for sync health states.

## Open Questions

- Should desktop and broker sync share the same cursor or keep separate cursors?
- How far back should bounded repair go by default?
- Should background sync pause automatically on battery saver or metered network?
- Which provider action types can be safely retried without reconciliation?
