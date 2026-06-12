# RFC email-008: Email Platform API and Ecosystem

| Field      | Value                                                    |
| ---------- | -------------------------------------------------------- |
| RFC        | email-008                                                |
| Status     | Draft                                                    |
| Track      | Desktop email                                            |
| Owner      | TBD                                                      |
| Created    | 2026-06-12                                               |
| Depends on | email-001, email-002, email-003                          |
| Related    | RFC 010, RFC 011, RFC 012, RFC 020, email-006, email-007 |

## Summary

Expose Rowboat email capabilities through a controlled platform API for local desktop integrations, broker APIs, webhooks, scoped API keys, import/export, and assistant tooling. Inbox Zero includes API keys with scoped access to stats, rules, settings, and assistant chat, plus webhook actions that send rule execution payloads. Rowboat's desktop app should support a similar ecosystem, but with stricter local-first defaults and a clear separation between local APIs, broker APIs, and external callbacks.

This RFC defines the platform surfaces that let email features become extensible without bypassing the mailbox provider, action engine, or audit policy.

## Inbox Zero Implementation References

Implementation agents should first read [email-000](./email-000-inbox-zero-agent-reference.md), then inspect:

- `docs/essentials/api-keys.mdx`
- `docs/essentials/call-webhook.mdx`
- `docs/openapi.json`
- `docs/api-reference/endpoint/get-rules.mdx`
- `docs/api-reference/endpoint/post-rules.mdx`
- `docs/api-reference/endpoint/get-statsby-period.mdx`
- `docs/api-reference/endpoint/get-statsresponse-time.mdx`
- `apps/web/prisma/schema.prisma` model `ApiKey`
- `apps/web/prisma/schema.prisma` enum `ApiKeyScope`
- `apps/web/app/api/v1/rules/route.ts`
- `apps/web/app/api/v1/rules/[id]/route.ts`
- `apps/web/app/api/v1/stats/by-period/route.ts`
- `apps/web/app/api/v1/stats/response-time/route.ts`
- `apps/web/app/api/user/api-keys/route.ts`
- `apps/web/utils/webhook-action.ts`
- `apps/web/utils/webhook.ts`
- `apps/web/utils/webhook-validation.ts`

Use these to mirror the useful API surface while preserving Rowboat's stricter local/broker split and action-policy enforcement.

## Source Analysis

| Source fact                                                                                                                               | Evidence                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbox Zero stores API keys with scopes for stats read, rules read/write, settings read/write, and assistant chat.                         | `inbox-zero/apps/web/prisma/schema.prisma` `ApiKey`, `ApiKeyScope`                                                                                               |
| Inbox Zero webhook actions send email and executed rule payloads with a shared secret header.                                             | `inbox-zero/docs/essentials/call-webhook.mdx`, `inbox-zero/apps/web/utils/ai/actions.ts`                                                                         |
| Inbox Zero has chat, chat messages, chat compaction, and chat memory tied to email accounts.                                              | `inbox-zero/apps/web/prisma/schema.prisma` `Chat`, `ChatMessage`, `ChatMemory`                                                                                   |
| Rowboat has broker APIs, local desktop IPC, background task runtime tools, and RFCs for connector consent and native third-party actions. | `apps/rowboat-api`, `apps/x/apps/main/src/ipc.ts`, `apps/rfc/012-connector-suite-and-consent-broker.md`, `apps/rfc/020-native-third-party-tool-action-engine.md` |

## Goals

- Provide stable local and broker APIs for Rowboat email features.
- Allow external systems to consume stats, rule state, digests, and action events.
- Support webhook actions with signatures, retries, and least-privilege payloads.
- Add scoped API keys or app tokens for automation clients.
- Make import/export of rules, sender decisions, and settings possible.
- Ensure external integrations cannot mutate mail outside the action engine.

## Non-Goals

- Publicly launching an email developer platform on day one.
- Exposing raw OAuth tokens or provider-native APIs.
- Allowing external clients to bypass user approval policy.
- Supporting multi-tenant organization administration before user-level APIs are stable.

## API Surfaces

### Desktop Local API

For local tools and Rowboat agents:

- IPC for renderer.
- Local HTTP or MCP surface only when explicitly enabled.
- Uses current desktop session and local permissions.
- Can access local-only email state.

Candidate local endpoints/tools:

- `mailbox.search`
- `mailbox.get_thread`
- `mailbox.draft_reply`
- `mailbox.archive_thread`
- `mailbox.mark_read`
- `mailbox.list_rules`
- `mailbox.test_rule`
- `mailbox.get_stats`
- `mailbox.get_digest`

### Broker API

For account-synced and cloud workflows:

- OAuth-authenticated user APIs.
- Scoped service tokens for automation.
- No raw full-body access by default.
- Supports cloud event ingestion and background tasks.

Candidate broker endpoints:

- `GET /v1/mail/accounts`
- `GET /v1/mail/stats`
- `GET /v1/mail/rules`
- `POST /v1/mail/rules`
- `POST /v1/mail/rules/{id}/test`
- `GET /v1/mail/actions`
- `GET /v1/mail/digests`
- `POST /v1/mail/webhooks/test`

## API Key Scopes

```ts
type EmailApiScope =
  | "mail.stats.read"
  | "mail.rules.read"
  | "mail.rules.write"
  | "mail.settings.read"
  | "mail.settings.write"
  | "mail.actions.read"
  | "mail.actions.write"
  | "mail.assistant.chat"
  | "mail.digest.read"
  | "mail.webhooks.write";
```

`mail.actions.write` should not imply send/forward/spam permission. High-impact action policies from email-003 still apply.

## Webhook Events

Outgoing webhook event types:

- `mail.rule.matched`
- `mail.action.succeeded`
- `mail.action.failed`
- `mail.digest.ready`
- `mail.reply_tracker.overdue`
- `mail.cleanup.completed`
- `mail.attachment.filed`
- `mail.account.needs_reconnect`

Webhook envelope:

```json
{
  "id": "evt_123",
  "type": "mail.action.succeeded",
  "createdAt": "2026-06-12T12:00:00Z",
  "accountId": "acct_123",
  "data": {
    "ruleRunId": "run_123",
    "actionRunId": "act_123"
  }
}
```

Headers:

- `X-Rowboat-Event-Id`
- `X-Rowboat-Timestamp`
- `X-Rowboat-Signature`

Delivery:

- Exponential retry with max age.
- Dead-letter status visible in command center.
- Redelivery button.
- Per-webhook payload policy: metadata only, summary, or full body.

## Import and Export

Exportable:

- Rules.
- Rule groups.
- Sender decisions.
- Cleanup settings.
- Digest settings.
- Reply Zero thresholds.
- Filing destinations without secrets.
- Webhook definitions without secrets.

Not exportable by default:

- OAuth tokens.
- API key secret values.
- Raw email bodies.
- Attachment contents.
- Learned writing style unless user explicitly includes it.

Format:

```json
{
  "version": "email-platform-export-v1",
  "createdAt": "2026-06-12T12:00:00Z",
  "rules": [],
  "senderDecisions": [],
  "settings": {}
}
```

## Assistant Chat API

The assistant chat API should be a thin orchestration layer over approved tools:

- Search mailbox.
- Summarize thread.
- Draft reply.
- Explain rule match.
- Create rule draft.
- Test rule.
- Show cleanup candidates.
- Generate digest.

Mutations should return a proposed action when policy requires confirmation. The chat API should not directly call provider send/archive functions.

## Audit and Governance

Every external interaction should leave an audit record:

- API key used.
- Scope.
- Actor.
- Endpoint/tool.
- Target account.
- Target thread/message/rule/action.
- Result.
- Error.
- Timestamp.

The command center should have an "External access" page with:

- API keys.
- Webhooks.
- Recent API calls.
- Failed webhook deliveries.
- Connected local tools.

## Security Requirements

- Store API key hashes only.
- Show API key secret once.
- Allow immediate revocation.
- Enforce per-scope and per-account access.
- Rate-limit API keys and webhooks.
- Sign webhook payloads.
- Prevent SSRF through webhook URL validation and egress policy.
- Never expose provider refresh/access tokens.
- Apply same auth backoff/reconnect behavior as the desktop auth controller.

## Detailed Code Examples

See [email-021](./email-021-implementation-blueprints-and-code-examples.md) for broker handler sketches.

### API Key Scope Check

```go
func RequireEmailScope(scope string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := APIKeyFromContext(r.Context())
		if key == nil || !key.Active {
			writeProblem(w, http.StatusUnauthorized, "api_key_required", "Valid API key required")
			return
		}

		if !key.HasScope(scope) {
			writeProblem(w, http.StatusForbidden, "missing_scope", "API key is missing required scope")
			return
		}

		next.ServeHTTP(w, r)
	})
}
```

### Webhook Signature

```ts
export function signWebhookPayload(input: {
  secret: string;
  eventId: string;
  timestamp: number;
  body: string;
}): string {
  const signed = `${input.eventId}.${input.timestamp}.${input.body}`;
  return createHmac("sha256", input.secret).update(signed).digest("hex");
}

export function verifyWebhookSignature(input: {
  secret: string;
  eventId: string;
  timestamp: number;
  body: string;
  signature: string;
  now: number;
}): boolean {
  if (Math.abs(input.now - input.timestamp) > 5 * 60_000) return false;

  const expected = signWebhookPayload(input);
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(input.signature, "hex"));
}
```

## Migration Plan

1. Define local tool/API schemas over existing mailbox operations.
2. Add scoped API key model in the broker.
3. Add read-only stats/rules APIs.
4. Add webhook destination model and signed test delivery.
5. Route `CALL_WEBHOOK` action from email-003 through the webhook delivery system.
6. Add import/export for rules and sender decisions.
7. Add assistant chat API backed by mailbox tools.
8. Add external access UI in the command center.

## Test Plan

- Scope enforcement tests for every endpoint/tool.
- API key hashing and revocation tests.
- Webhook signature verification tests.
- Retry/dead-letter tests.
- Import/export round-trip tests.
- Assistant mutation tests proving approval policy is preserved.
- Security tests for SSRF-blocked webhook URLs.
- Manual test: create API key, read stats, test webhook, trigger rule action, revoke key.

## Open Questions

- Should local MCP/email tools be enabled by default for Rowboat agents, or opt-in per workspace?
- Should broker API keys be user-level only at launch?
- How much of the API should be stable before these features are documented publicly?
- Should webhook payload policies be per destination, per event type, or per rule action?
