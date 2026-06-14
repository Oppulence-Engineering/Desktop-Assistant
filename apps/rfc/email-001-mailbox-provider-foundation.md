# RFC email-001: Mailbox Provider Foundation

| Field      | Value                              |
| ---------- | ---------------------------------- |
| RFC        | email-001                          |
| Status     | Draft                              |
| Track      | Desktop email                      |
| Owner      | TBD                                |
| Created    | 2026-06-12                         |
| Depends on | RFC 003, RFC 012, RFC 019, RFC 020 |
| Related    | email-002, email-003               |

## Summary

Build a provider-neutral mailbox foundation for the desktop app and broker-backed cloud workflows. Rowboat already has a strong Gmail desktop sync path, but it is Gmail-shaped end to end: IPC names, renderer state, local cache paths, thread URLs, and provider actions all assume Gmail. Inbox Zero's email surface is broader: every feature routes through a provider abstraction that supports Gmail and Outlook, then higher-level systems operate on normalized messages, threads, labels, folders, attachments, watches, and actions.

This RFC proposes a `MailboxProvider` layer, normalized mailbox data model, account capability model, and sync/watch pipeline that can support Gmail first and Outlook next without rewriting every product feature.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect these Inbox Zero files:

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

Translate these into Rowboat's `apps/x/packages/core` mailbox interfaces and `apps/rowboat-api/internal/googleapi`/future provider adapters. Do not copy the Next.js server-action shape.

## Source Analysis

| Source fact                                                                                                                                                                                                             | Evidence                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbox Zero centralizes provider behavior behind an email provider abstraction instead of leaking Gmail/Microsoft details across feature code.                                                                           | `inbox-zero/apps/web/utils/email/provider.ts`, `inbox-zero/apps/web/utils/email/types.ts`                                                                                          |
| Inbox Zero's provider interface covers read, search, labels, folders, drafts, send/reply/forward, archive/trash, mark read/spam/star, filters, watches, and attachments.                                                | `inbox-zero/apps/web/utils/email/types.ts`                                                                                                                                         |
| Inbox Zero persists account-level state for watches, history cursors, writing style, rules revision, follow-up thresholds, digests, filing, and channels.                                                               | `inbox-zero/apps/web/prisma/schema.prisma` `EmailAccount`                                                                                                                          |
| Rowboat desktop currently has a Google-only Gmail sync loop with `gmail.modify`, 30 second sync interval, local markdown/thread snapshots, attachments, reply/send, archive/trash/read actions, and Gmail-specific IPC. | `apps/x/packages/core/src/knowledge/sync_gmail.ts`, `apps/x/apps/renderer/src/components/email-view.tsx`, `apps/x/apps/main/src/ipc.ts`                                            |
| Rowboat cloud already has normalized cloud events and Google watch infrastructure that can be reused for mailbox watches.                                                                                               | `apps/rfc/003-cloud-event-ingestion.md`, `apps/rfc/019-google-push-infrastructure.md`, `apps/rowboat-api/ent/schema/cloud_event.go`, `apps/rowboat-api/ent/schema/google_watch.go` |
| Rowboat backend currently exposes read-only Gmail snippets to background tools, not full mailbox operations.                                                                                                            | `apps/rowboat-api/internal/googleapi/gmail.go`, `apps/rowboat-api/internal/backgroundtaskruntime/tools_connectors.go`                                                              |

## Goals

- Introduce a provider-neutral mailbox contract for desktop and broker workflows.
- Preserve the current Gmail desktop experience while making it a provider implementation, not the product contract.
- Support scoped capabilities: read, modify, send, watch, calendar-aware drafting, and attachment filing.
- Normalize message/thread/label/folder identifiers without losing provider-native IDs needed for API calls.
- Give future RFCs a stable base for automation rules, reply tracking, cleanup, digests, and integrations.
- Keep local-first desktop usage functional even when broker/cloud services are unavailable.

## Non-Goals

- Replacing every Gmail-specific UI in the first milestone.
- Implementing Microsoft Graph in this RFC. The foundation must make it possible; Gmail remains the first implementation.
- Building the full automation engine, reply-zero workflow, newsletter cleanup, or analytics. Those are separate RFCs.
- Moving full raw email bodies into Rowboat cloud by default.

## Design

### Provider Contract

Add a core mailbox provider interface in `apps/x/packages/core/src/mailbox/provider.ts` and a matching broker-side package under `apps/rowboat-api/internal/mailbox`.

The desktop interface should model operations by capability:

```ts
export interface MailboxProvider {
  readonly provider: "gmail" | "outlook";
  readonly accountId: string;
  readonly accountEmail: string;
  readonly capabilities: MailboxCapability[];

  getThread(id: MailboxThreadRef, options?: GetThreadOptions): Promise<MailboxThread>;
  listThreads(query: MailboxQuery): Promise<MailboxThreadPage>;
  searchMessages(query: MailboxSearchQuery): Promise<MailboxMessagePage>;
  listLabels(): Promise<MailboxLabel[]>;
  listFolders(): Promise<MailboxFolder[]>;
  listHistory(cursor: MailboxCursor): Promise<MailboxHistoryPage>;

  archiveThread(id: MailboxThreadRef): Promise<void>;
  trashThread(id: MailboxThreadRef): Promise<void>;
  markThreadRead(id: MailboxThreadRef): Promise<void>;
  moveThread(id: MailboxThreadRef, folderId: string): Promise<void>;
  applyLabel(id: MailboxThreadRef, labelId: string): Promise<void>;

  createDraft(input: MailboxDraftInput): Promise<MailboxDraft>;
  updateDraft(id: string, input: MailboxDraftInput): Promise<MailboxDraft>;
  deleteDraft(id: string): Promise<void>;
  sendDraft(id: string): Promise<MailboxSentMessage>;
  sendEmail(input: MailboxSendInput): Promise<MailboxSentMessage>;
  reply(input: MailboxReplyInput): Promise<MailboxSentMessage>;
  forward(input: MailboxForwardInput): Promise<MailboxSentMessage>;
}
```

Broker-side interfaces can be smaller at first and should avoid full body access unless a feature explicitly requires it.

### Capability Tiers

Accounts should declare capabilities separately from provider type:

| Capability         | Gmail scope today                          | Future Outlook scope  | Used by                  |
| ------------------ | ------------------------------------------ | --------------------- | ------------------------ |
| `mail.read`        | `gmail.readonly` or current `gmail.modify` | `Mail.Read`           | search, view, analytics  |
| `mail.modify`      | `gmail.modify`                             | `Mail.ReadWrite`      | archive, labels, cleanup |
| `mail.send`        | `gmail.send` or current `gmail.modify`     | `Mail.Send`           | send, reply, forward     |
| `mail.draft`       | `gmail.compose` or current `gmail.modify`  | `Mail.ReadWrite`      | AI drafts                |
| `mail.watch`       | Gmail Pub/Sub watch                        | Graph subscriptions   | push sync                |
| `mail.attachments` | Gmail attachment read                      | Graph attachment read | filing                   |

The desktop app can continue requesting the existing Gmail scope during migration, but new UI and broker APIs should reason over capabilities.

### Normalized Identity

Every mailbox object should carry both Rowboat IDs and provider-native refs:

```ts
export type MailboxProviderRef = {
  provider: "gmail" | "outlook";
  accountId: string;
  accountEmail: string;
};

export type MailboxThreadRef = MailboxProviderRef & {
  providerThreadId: string;
  rowboatThreadId?: string;
};

export type MailboxMessageRef = MailboxThreadRef & {
  providerMessageId: string;
  providerHeaderMessageId?: string;
  rowboatMessageId?: string;
};
```

Provider-native IDs remain opaque. Rowboat IDs are stable hashes or database IDs used by local state, rules, analytics, and cloud event dedupe.

### Local Store

Add a local mailbox store under the desktop app, backed by SQLite when available and a file cache fallback if necessary:

- `mailbox_accounts`
- `mailbox_threads`
- `mailbox_messages`
- `mailbox_labels`
- `mailbox_folders`
- `mailbox_attachments`
- `mailbox_history_cursors`
- `mailbox_sync_runs`

The current markdown export under `gmail_sync` can remain as a knowledge artifact, but product state should not depend on markdown files as the source of truth.

### Cloud Event Bridge

Gmail and future Outlook watches should emit normalized cloud events:

```json
{
  "source": "gmail",
  "type": "mail.thread.changed",
  "dedupe_key": "gmail:account:history:12345",
  "subject": "New message in thread",
  "payload_ref": "sealed-provider-payload"
}
```

The broker should continue to seal raw provider payloads as RFC 003 describes. The mailbox layer consumes those events and asks the provider for the minimal needed data.

### Sync Modes

Support three sync modes:

| Mode                | Trigger                                       | Purpose                                                |
| ------------------- | --------------------------------------------- | ------------------------------------------------------ |
| Initial backfill    | Account connect or manual repair              | Build local index and recent thread cache              |
| Incremental history | Provider watch or desktop poll                | Keep local state fresh                                 |
| On-demand hydration | User opens thread or automation needs context | Fetch full message bodies/attachments only when needed |

Desktop polling can remain as a fallback. Broker push should drive cloud automation and reduce repeated desktop calls.

## Data Model

### `MailboxAccount`

```ts
type MailboxAccount = {
  id: string;
  userId: string;
  provider: "gmail" | "outlook";
  providerAccountId: string;
  email: string;
  displayName?: string;
  capabilities: MailboxCapability[];
  syncState: "active" | "paused" | "needs_reconnect" | "rate_limited" | "error";
  lastHistoryCursor?: string;
  watchExpiresAt?: string;
  lastSyncAt?: string;
  lastError?: string;
};
```

### `MailboxThread`

```ts
type MailboxThread = {
  id: string;
  providerThreadId: string;
  accountId: string;
  subject: string;
  participants: MailboxParticipant[];
  latestMessageAt: string;
  unread: boolean;
  labels: MailboxLabelRef[];
  folderIds: string[];
  messages: MailboxMessage[];
  snippet?: string;
  summary?: string;
};
```

### `MailboxMessage`

```ts
type MailboxMessage = {
  id: string;
  providerMessageId: string;
  headerMessageId?: string;
  threadId: string;
  accountId: string;
  sentAt: string;
  from: MailboxParticipant;
  to: MailboxParticipant[];
  cc: MailboxParticipant[];
  bcc: MailboxParticipant[];
  subject: string;
  textBody?: string;
  htmlBodyRef?: string;
  snippet?: string;
  attachments: MailboxAttachment[];
  isInbound: boolean;
  isDraft: boolean;
  isSent: boolean;
  isInbox: boolean;
};
```

## API and IPC

### Desktop IPC

Replace Gmail-specific public IPC with mailbox aliases while keeping compatibility shims:

- `mailbox:listThreads`
- `mailbox:getThread`
- `mailbox:search`
- `mailbox:triggerSync`
- `mailbox:getConnectionStatus`
- `mailbox:archiveThread`
- `mailbox:trashThread`
- `mailbox:markThreadRead`
- `mailbox:moveThread`
- `mailbox:applyLabel`
- `mailbox:createDraft`
- `mailbox:updateDraft`
- `mailbox:sendDraft`
- `mailbox:sendReply`
- `mailbox:sendEmail`
- `mailbox:forward`

Existing `gmail:*` IPC should delegate to the mailbox APIs until renderer migration is complete.

### Broker API

Initial broker endpoints:

- `GET /v1/mail/accounts`
- `GET /v1/mail/accounts/{account_id}/capabilities`
- `GET /v1/mail/threads?query=...`
- `GET /v1/mail/threads/{thread_id}`
- `POST /v1/mail/threads/{thread_id}/actions/archive`
- `POST /v1/mail/threads/{thread_id}/actions/mark-read`
- `POST /v1/mail/drafts`
- `POST /v1/mail/drafts/{draft_id}/send`

The broker should start with actions needed by background tasks and only expose full email bodies to authorized account owners.

## Detailed Code Examples

See [email-021](./email-021-implementation-blueprints-and-code-examples.md) for the full implementation blueprint. This RFC's minimum useful first step is to wrap the existing Gmail sync/action code behind a provider interface without changing renderer behavior.

### Adapter Wrapper Around Existing Gmail Code

```ts
// apps/x/packages/core/src/mailbox/provider-gmail-legacy.ts

export class GmailLegacyMailboxProvider implements MailboxProvider {
  readonly kind = "gmail" as const;

  constructor(
    readonly account: MailboxAccount,
    private readonly deps: {
      gmailSync: {
        getThread(providerThreadId: string): Promise<GmailThreadSnapshot | null>;
        archiveThread(providerThreadId: string): Promise<void>;
        trashThread(providerThreadId: string): Promise<void>;
        markThreadRead(providerThreadId: string): Promise<void>;
        sendThreadReply(input: SendThreadReplyInput): Promise<void>;
      };
    },
  ) {}

  async getThread(ref: MailboxThreadRef): Promise<MailboxThread> {
    const snapshot = await this.deps.gmailSync.getThread(ref.providerThreadId);
    if (!snapshot) {
      throw new MailboxProviderError("Thread not found", "unknown", {
        provider: "gmail",
        operation: "getThread",
        accountId: this.account.id,
      });
    }

    return normalizeLegacyGmailSnapshot(this.account, snapshot);
  }

  async archiveThread(ref: MailboxThreadRef): Promise<void> {
    await this.deps.gmailSync.archiveThread(ref.providerThreadId);
  }

  async trashThread(ref: MailboxThreadRef): Promise<void> {
    await this.deps.gmailSync.trashThread(ref.providerThreadId);
  }

  async markThreadRead(ref: MailboxThreadRef): Promise<void> {
    await this.deps.gmailSync.markThreadRead(ref.providerThreadId);
  }
}
```

### Compatibility IPC Shim

Keep existing `gmail:*` IPC temporarily, but route it through mailbox services:

```ts
ipcMain.handle("gmail:archiveThread", async (_event, threadId: string) => {
  const account = await mailboxService.getDefaultAccount({ provider: "gmail" });
  return mailboxService.executeAction({
    accountId: account.id,
    actionType: "archive",
    target: { providerThreadId: threadId },
    source: "legacy_gmail_ipc",
  });
});

ipcMain.handle("mailbox:archiveThread", async (_event, input) => {
  const parsed = z
    .object({
      accountId: z.string(),
      providerThreadId: z.string(),
    })
    .parse(input);

  return mailboxService.executeAction({
    accountId: parsed.accountId,
    actionType: "archive",
    target: { providerThreadId: parsed.providerThreadId },
    source: "renderer",
  });
});
```

### Stable Rowboat IDs

Provider-native IDs remain opaque; Rowboat IDs are deterministic wrappers:

```ts
export function normalizeMailboxThreadId(input: {
  provider: MailboxProviderKind;
  accountId: string;
  providerThreadId: string;
}): string {
  return stableHash(["mailbox_thread_v1", input.provider, input.accountId, input.providerThreadId]);
}
```

## Privacy and Security

- Default to local-first full body storage. Broker cloud state should store metadata and sealed raw payloads only when required.
- Treat provider refresh and reconnect state as account availability, not silent sign-out.
- Require explicit scopes for destructive actions and sending.
- Store attachments separately from message metadata and track provenance.
- Never log email bodies, recipient lists, raw OAuth tokens, or attachment contents.
- Actions with external effects should produce audit records.

## Migration Plan

1. Add mailbox model types and Gmail implementation that wraps `sync_gmail.ts` behavior.
2. Add compatibility shims from `gmail:*` IPC to `mailbox:*` IPC.
3. Move renderer state from Gmail-specific names to mailbox names without changing visible behavior.
4. Move local cache metadata into the mailbox store while keeping markdown knowledge export.
5. Add broker read-only mailbox APIs backed by existing Google OAuth and `internal/googleapi`.
6. Add watch-to-mailbox event handling using RFC 019 infrastructure.
7. Add Outlook provider behind feature flag.

## Test Plan

- Unit-test provider contract adapters with Gmail fixtures.
- Golden-test normalization for Gmail headers, labels, attachments, and thread IDs.
- Integration-test local sync backfill, incremental history, and on-demand hydration.
- Verify compatibility of old `gmail:*` IPC calls during migration.
- Broker tests for capability enforcement and sealed payload handling.
- Manual desktop test: connect Gmail, sync, read, archive, mark read, reply, restart, and confirm cached state survives.

## Open Questions

- Should the desktop local store use the existing app database layer or a dedicated mailbox SQLite database?
- Which mailbox features must be available offline versus requiring provider round trips?
- How much provider payload should be mirrored to Rowboat cloud for cloud-only background tasks?
- Should Outlook support launch as read-only first, or wait until modify/send are available?
