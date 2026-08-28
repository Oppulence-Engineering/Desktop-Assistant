# oauth-consent

The Ory Hydra login and connector-consent application for RFC 012 broker mode.
Hydra and this app remain outside the current WorkOS-direct desktop sign-in path,
but the broker-mode implementation is complete and tested for a future
cross-product or self-hosted deployment.

## Behavior

### Hydra login and logout

- `/login` fetches the Hydra login request and redirects non-skipped requests to
  WorkOS.
- `/callback` verifies the WorkOS `id_token` signature, issuer, audience,
  subject, and OIDC nonce before accepting the Hydra login.
- Login state and browser cookies are opaque, signed, and expiring. The callback
  claims state with a database lease, persists the verified WorkOS subject,
  records the may-have-committed Hydra phase before accepting, and retains the
  completion redirect for safe replay after transient failures or process death.
- `/logout` preserves Hydra's logout challenge/accept flow.

### Consent state machine

A Hydra consent challenge is never auto-accepted. The service uses this shared,
PostgreSQL-backed expiring state machine:

```text
created -> shown -> processing -> approved
                 \-> processing -> denied
                 \-> processing -> invalidated
                 \-> step_up_pending -> processing -> approved
created/shown/step_up_pending/processing -> failed
```

`GET /consent`:

1. Fetches the Hydra request.
2. Calls the signed rowboat-api context hook.
3. Requires exact subject, Hydra client ID, single audience, and scope-set
   matches.
4. Atomically creates or reuses the challenge session and its deterministic
   `<session>:shown` audit-outbox event.
5. Renders either the consent form or a separate entitlement/upsell denial
   page.

The form renders product identity and the exact `Rowboat Desktop` client
identity from the hook. Scope `display_name` and `description` are rendered only
from structured hook data. Scopes are grouped as `low`, `medium`, `high`, and
`money_moving`, with required scopes fixed and optional scopes selectable.
Approving or denying is always an explicit CSRF-protected `POST`.

Selected `high` or `money_moving` scopes require a separate acknowledgement.
Any selected scope with `requires_step_up: true` enters a separate WorkOS OIDC
flow using a new state, browser binding, and OIDC nonce. Approval
requires the returned subject to match the Hydra subject, `amr` to contain
`WORKOS_STEP_UP_AMR`, and `acr` to exactly equal `WORKOS_STEP_UP_ACR`.
The callback claims the flow with a database lease but does not consume it until
token and assurance verification succeeds. Transient token-exchange or JWKS
failures atomically create a fresh flow with the same browser binding; the old
state remains a retry alias so a dropped recovery redirect returns the same
fresh authorization URL.

Before the first Hydra approval attempt, the service repeats the signed
context/entitlement request and checks identity, audience, connector, scope
policy, selected scopes, and current entitlement. Policy drift at that point is
converted to a Hydra denial; hook timeout or signature failure makes no Hydra
decision and leaves durable retry work. After Hydra acceptance is known, the
accepted fact and grant audit are irreversible. A second authoritative check
then either completes `approved` or performs an explicit `invalidated`
transition with its own deterministic denial audit. Replayed forms, stale
cookies, and replaced challenges fail closed. Upstream errors expose only
stable local error codes and never include upstream response bodies.

### Shared state and audit delivery

Production requires `DATABASE_URL`. The image packages `migrations/`, and the
Helm Deployment runs `npm run migrate` in an init container under a PostgreSQL
advisory lock before any application container starts. Login, consent, CSRF,
challenge, and step-up records use database TTL checks and atomic compare-and-set
transitions, so requests may move between replicas.

Before Hydra is called, the chosen decision, selected scopes, complete final
audit payload, and an `accept_pending` or `reject_pending` may-have-committed
phase are durably committed and leased to one worker. A unique index permits
only one session per Hydra challenge. Recovery probes Hydra before doing
anything that could change the decision. A terminal approval challenge is
persisted as `accepted`, can never be rewritten to denial, and first converges
the stable `<session>:final` grant audit. Post-commit entitlement or policy drift
then commits `invalidated` and `<session>:invalidated` as a separate explicit
transition. Repeated and concurrent recovery uses the same deterministic IDs,
so both semantic events converge exactly once. Two reconcilers cannot own the
same live lease. Any replica claims outbox rows with `FOR UPDATE SKIP LOCKED`
and exponential backoff. Expired browser flows and non-processing sessions,
plus delivered audit rows older than 30 days, are cleaned periodically.

`/healthz` is process liveness only. `/readyz` executes `SELECT 1` and returns
503 when PostgreSQL is unavailable. The chart uses `/readyz` for readiness.

When NetworkPolicy is enabled, PostgreSQL egress is denied unless
`networkPolicy.postgresql.cidrs` explicitly lists destination CIDRs. Set these
to the managed database private endpoint ranges and set
`networkPolicy.postgresql.port` if it is not 5432. Do not use `0.0.0.0/0`.

Run PostgreSQL multi-instance, lease, crash, entitlement-drift, and
restart/replay tests with:

```bash
TEST_DATABASE_URL=postgres://... npm test
```

The release gate is intentionally stricter and cannot silently skip this suite:

```bash
npm run test:release
```

It starts pinned PostgreSQL 16.10, sets `REQUIRE_POSTGRES_STATE_TESTS=true`, and
fails before collection if `TEST_DATABASE_URL` is absent. Release CI invokes
this command directly.

## rowboat-api hook contract

Both hook requests and responses are signed over the exact UTF-8 body:

```text
base64url(HMAC-SHA256(HOOK_HMAC_SECRET, "<timestamp>.<nonce>.<body>"))
```

Headers:

```text
X-Hook-Timestamp: <unix epoch milliseconds>
X-Hook-Nonce: <opaque base64url nonce>
X-Hook-Signature: sha256=<base64url signature>
```

The response must echo the request nonce, have a timestamp within
`HOOK_SIGNATURE_MAX_AGE_MS`, and carry a valid signature. JSON is parsed only
after signature verification.

### Context hook

Default: `POST /oauth-hooks/pre-consent`

Request:

```json
{
  "version": 1,
  "challenge": "hydra-consent-challenge",
  "workos_user_id": "user_123",
  "hydra_client_id": "rowboat-desktop",
  "requested_audience": ["mcp:canvas"],
  "requested_scopes": ["canvas:invoices.read"]
}
```

Response:

```json
{
  "request_id": "ctx_123",
  "subject": "user_123",
  "client": {
    "id": "rowboat-desktop",
    "display_name": "Rowboat Desktop"
  },
  "connector": {
    "id": "canvas",
    "display_name": "Canvas",
    "audience": "mcp:canvas"
  },
  "scopes": [
    {
      "name": "canvas:invoices.read",
      "display_name": "Read invoices",
      "description": "View invoice records in Canvas.",
      "tier": "low",
      "required": true,
      "requires_step_up": false
    }
  ],
  "entitlement": {
    "allowed": true
  }
}
```

A denied entitlement uses one of RFC 012's stable reasons and may provide plan
presentation data:

```json
{
  "allowed": false,
  "reason": "scope_not_in_plan",
  "required_plan": "business",
  "upgrade_url": "rowboat://billing",
  "message": "This connector requires the Business plan."
}
```

Allowed reasons are `no_subscription`, `scope_not_in_plan`, `user_banned`,
`org_mismatch`, and `connector_disabled`. `upgrade_url` must use `https:` or
`rowboat:`. Unknown response keys, duplicate scope definitions, unknown Hydra
scopes, multiple audiences, or identity mismatches are rejected.

### Audit hook

Default: `POST /oauth-hooks/consent-audit`

Request shape:

```json
{
  "version": 1,
  "event_id": "opaque-id",
  "event": "consent.shown",
  "occurred_at": "2026-08-27T19:49:52.773Z",
  "consent_session_id": "opaque-session-id",
  "context_request_id": "ctx_123",
  "workos_user_id": "user_123",
  "client_id": "rowboat-desktop",
  "connector_id": "canvas",
  "audience": "mcp:canvas",
  "scopes": ["canvas:invoices.read"],
  "result": "eligible"
}
```

`event` is one of `consent.shown`, `consent.granted`, or `consent.denied`.
The response is:

```json
{ "accepted": true }
```

The shown event is durably enqueued in the same transaction that creates the
session, before rendering. Final decision intent is persisted before Hydra,
while the final semantic audit is transactionally enqueued only after Hydra
converges. Pending intents are reconciled after faults, and audit delivery is
deduplicated by stable `event_id`.

## Backend alignment assumptions

The coordinator should align rowboat-api to these explicit assumptions:

1. One consent request targets exactly one connector audience.
2. The context hook returns the complete, exact scope set requested by Hydra.
   The consent app has no fallback catalog and intentionally invents no scope
   copy.
3. `subject` is the WorkOS user ID and must equal Hydra's subject.
4. `client.id` must equal Hydra's client ID and `client.display_name` must be the
   exact literal `Rowboat Desktop`.
5. A `money_moving` scope always has `requires_step_up: true`.
6. Hook responses are HMAC-signed as well as requests, using the same nonce and
   secret.
7. The audit hook durably accepts an event before returning
   `{ "accepted": true }` and deduplicates by `event_id`.
8. The configured WorkOS tenant emits an OIDC `nonce`, an `amr` array containing
   the configured MFA method, and an `acr` exactly matching the requested
   step-up value.
9. Production uses `PostgresStateStore`; `StateStore` is process-local test
   infrastructure only.

## Configuration

| Variable                      | Purpose                                                             | Default                                          |
| ----------------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| `PORT`                        | Listen port                                                         | `3000`                                           |
| `COOKIE_SECRET`               | HMAC key for browser bindings, minimum 32 characters                | required                                         |
| `COOKIE_SECURE`               | Set consent cookies `Secure`; set `false` only for local HTTP tests | `true`                                           |
| `CONSENT_SESSION_TTL_MS`      | Login, consent, and step-up state TTL                               | `600000`                                         |
| `UPSTREAM_TIMEOUT_MS`         | Ory, WorkOS, and rowboat-api request timeout                        | `5000`                                           |
| `DATABASE_URL`                | Shared PostgreSQL connection string                                 | required                                         |
| `AUDIT_RETRY_INTERVAL_MS`     | Audit and decision reconciliation interval                          | `5000`                                           |
| `DECISION_LEASE_MS`           | Hydra decision and MFA claim lease duration                         | `30000`                                          |
| `ORY_ADMIN_URL`               | Hydra Admin API base URL                                            | cluster-local Hydra URL                          |
| `WORKOS_CLIENT_ID`            | WorkOS OIDC client ID                                               | required                                         |
| `WORKOS_API_KEY`              | WorkOS confidential client secret                                   | required                                         |
| `WORKOS_ISSUER`               | Exact WorkOS issuer and discovery base URL                          | `https://auth.solomon-ai.co`                     |
| `WORKOS_REDIRECT_URI`         | Registered login callback URI                                       | `https://consent.solomon-ai.co/callback`         |
| `WORKOS_STEP_UP_REDIRECT_URI` | Separately registered step-up callback URI                          | `https://consent.solomon-ai.co/step-up/callback` |
| `WORKOS_STEP_UP_ACR`          | Exact requested and accepted money-moving assurance context         | `urn:rowboat:loa:money-moving`                   |
| `WORKOS_STEP_UP_AMR`          | Required `amr` entry                                                | `mfa`                                            |
| `ROWBOAT_API_URL`             | rowboat-api hook base URL                                           | `https://api.x.solomon-ai.co`                    |
| `HOOK_HMAC_SECRET`            | Shared hook HMAC key, minimum 32 characters                         | required                                         |
| `CONSENT_CONTEXT_HOOK_PATH`   | Context/entitlement hook path                                       | `/oauth-hooks/pre-consent`                       |
| `CONSENT_AUDIT_HOOK_PATH`     | Consent audit hook path                                             | `/oauth-hooks/consent-audit`                     |
| `HOOK_SIGNATURE_MAX_AGE_MS`   | Maximum signed-response clock skew/age                              | `300000`                                         |

WorkOS must register both callback URIs. Production must use HTTPS and leave
`COOKIE_SECURE=true`.

## Develop and validate

```bash
npm ci
npm run format
npm run typecheck
npm test
npm run build
```

Vitest integration tests start real local HTTP servers for mock Hydra Admin,
WorkOS discovery/JWKS/token endpoints, and signed rowboat-api context/audit
hooks. They cover login/logout, rendering and selection, entitlement denial,
high-scope acknowledgement, successful and failed MFA step-up, approve/deny,
HMAC verification, unknown scopes, audience and identity mismatch, CSRF, replay,
scope escalation, and safe upstream failures.
