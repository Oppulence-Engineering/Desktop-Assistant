# [Complete] RFC 010: Rowboat API Service Plane

|                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**          | 010                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Status**       | Complete — deployed via `charts/rowboat-api`: WorkOS-direct auth, append-only credit ledger (reserve/settle/refund), LLM gateway, Google/Exa/voice/Composio proxies, tenant-scoped ent (with negative tests), and kind+Helm gates. All acceptance criteria met. Post-RFC hardening (this pass): per-dependency `/readyz` checks (incl. optional `workos_jwks`), `retryable` on the error envelope, Composio `Idempotency-Key` propagation, and `user_id` on access logs. Route/response shapes follow the **deployed contract** (the service-boundary table + RFC 9457 errors), which supersedes the illustrative route-contract/JSON examples below. |
| **Track**        | Backend service plane                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Owners**       | `apps/rowboat-api`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Created**      | 2026-06-06                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Last updated** | 2026-06-06                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Depends on**   | WorkOS AuthKit direct auth, ent/Postgres, Infisical, local kind stack                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Related**      | [RFC 011](./complete-011-identity-and-authorization-plane.md), [RFC 012](./012-connector-suite-and-consent-broker.md), [RFC 007](./007-production-cloud-enablement.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Refs**         | Supersedes former backend implementation plan; operational references: [`docs/BACKEND_DEPLOYMENT.md`](../../docs/BACKEND_DEPLOYMENT.md), [`docs/LOCAL_KIND_ROWBOAT_API.md`](../../docs/LOCAL_KIND_ROWBOAT_API.md).                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Summary

`apps/rowboat-api` is the hosted service plane for Rowboat Desktop. It replaces the
legacy hosted `API_URL` dependency with a Go service that owns account identity
verification, billing/credits, vendor key access, LLM/voice/search proxying, Google
OAuth token refresh, Composio proxying, and the backend half of cloud background
workflows.

This RFC defines the service boundary and rollout contract for the API itself. It
does not define the cross-product OAuth connector broker; that is [RFC 012](./012-connector-suite-and-consent-broker.md).

## Current state

The backend exists and is deployed through the same chart path used by kind,
staging, and production:

| Capability                       | Source                                                          |
| -------------------------------- | --------------------------------------------------------------- |
| Go API service and chart         | `apps/rowboat-api`, `charts/rowboat-api`                        |
| Local kind workflow              | `scripts/rowboat-api-kind.sh`, `docs/LOCAL_KIND_ROWBOAT_API.md` |
| WorkOS-direct production posture | `docs/BACKEND_DEPLOYMENT.md`                                    |
| Desktop API surfaces             | this RFC's route contract and service boundary                  |
| Cloud background task routes     | RFCs 001-007                                                    |

The older implementation plan still describes Hydra as the primary issuer for the
desktop. The current deployment doc supersedes that for the live path: the desktop
signs in directly to WorkOS AuthKit; Hydra/Ory is deferred until the connector
broker or a self-hosted sovereignty tier needs a self-controlled authorization
server. RFC 011 resolves that split explicitly.

## Goals

- Provide one canonical API service boundary for Rowboat Desktop.
- Keep account, quota, vendor-key, OAuth-refresh, proxy, and cloud-run concerns out
  of the Electron app.
- Preserve signed-out direct-provider fallback paths where the desktop already
  supports user-supplied keys.
- Keep all data scoped per user at the ORM layer.
- Make local kind validation match the production Helm path.
- Keep the API small enough that product MCP traffic is not proxied through it.

## Non-Goals

- Replacing product MCP servers with rowboat-api handlers.
- Replacing local desktop execution or local BYO-key operation.
- Owning WorkOS user-management UI.
- Defining connector OAuth consent UX; see RFC 012.
- Defining hosted `apps/rowboat` platform auth; see RFC 015.

## Service boundary

The API owns:

| Area                            | Endpoints / packages                                           |
| ------------------------------- | -------------------------------------------------------------- |
| Config discovery                | `GET /v1/config`                                               |
| Account and credits             | `GET /v1/me`, `internal/billing`, `internal/quota`             |
| LLM gateway                     | `POST /v1/llm/*`, `GET /v1/llm/models`                         |
| Voice TTS proxy                 | `POST /v1/voice/text-to-speech/{voiceId}`                      |
| Search proxy                    | `POST /v1/search/exa`                                          |
| Google OAuth refresh            | `POST /v1/google-oauth/claim`, `POST /v1/google-oauth/refresh` |
| Composio proxy                  | `* /v1/composio/*`                                             |
| Background task cloud execution | `/v1/background-tasks`, `/v1/background-task-runs`             |
| Connector registry/broker       | `/v1/connectors`, `/v1/connections/*` after RFC 012            |
| Internal invalidation/hooks     | `/v1/internal/*`, `/oauth-hooks/*` after RFC 012               |

The API does not own:

- Gmail/Calendar/Fireflies desktop sync loops.
- Product data reads/writes over MCP.
- User-owned local vault data.
- PostHog desktop analytics ingestion.
- Stripe/Polar checkout UI, except for persisted subscription state exposed through
  `/v1/me`.

## Data model

The service plane requires the following stable entities. Existing ent schemas may
already cover some of them; this RFC fixes the product contract rather than the
exact generated code shape.

| Entity            | Purpose                                                                            |
| ----------------- | ---------------------------------------------------------------------------------- |
| `User`            | Local mirror of WorkOS user identity (`workos_user_id`, `email`, optional org id). |
| `Subscription`    | Plan/status and sanctioned credits.                                                |
| `CreditLedger`    | Append-only credits granted, reserved, settled, refunded, or consumed.             |
| `LLMUsage`        | Per-call model/token/cost/use-case accounting.                                     |
| `OAuthPending`    | Short-lived handoff tickets for Google and connector callback flows.               |
| `OAuthConnection` | Long-lived user OAuth tokens for external providers such as Google.                |
| `MCPConnection`   | Cross-product connector refresh tokens and granted scopes after RFC 012.           |
| `ComposioLink`    | Mapping between Rowboat user identity and Composio tenancy, if required.           |

All user-owned rows must have a user edge and be covered by the same tenant-scoping
interceptors used by background-task entities.

## Authentication

For the live WorkOS-direct path:

1. Desktop discovers issuer/config from `GET /v1/config`.
2. Desktop completes WorkOS AuthKit PKCE directly.
3. Desktop calls API routes with the WorkOS access token.
4. rowboat-api validates the JWT against WorkOS JWKS, upserts/loads the local
   `User`, and attaches user context to ent.

For future Hydra/Ory broker mode, RFC 011 defines when rowboat-api accepts
Ory-issued tokens and how that coexists with WorkOS-direct tokens.

## Quota and billing

Quota is enforced server-side even when the desktop shows client-side limits.

The preferred LLM accounting flow:

1. Estimate request cost and reserve credits using a unique `request_id`.
2. Stream the upstream call.
3. Settle actual token cost at completion.
4. Refund reservation on upstream error or client cancellation.

`CreditLedger` remains append-only; idempotency is keyed by `request_id`. The API
returns `402` with `code=insufficient_credits` before making upstream calls when
the reservation would exceed balance.

## Vendor key handling

Server-held vendor keys live in Infisical/Kubernetes secrets and are never sent to
the desktop. The API may use them for signed-in users on:

- LLM providers.
- ElevenLabs TTS.
- Exa Search.
- Composio.
- Google OAuth client secret during refresh.

When the user is signed out or supplies BYO keys locally, the desktop may continue
to call vendors directly. This is intentionally preserved for local-first use.

## Deployment

The deployment path is:

1. Provision external resources: Postgres, Redis, WorkOS, Infisical, DNS, and
   Kubernetes secrets.
2. Apply migrations.
3. Deploy `charts/rowboat-api` with environment values.
4. Validate `/healthz`, `/readyz`, `/v1/config`, `/openapi.json`, and `/docs`.
5. Run the desktop against the deployed API.

Local validation uses the kind stack:

- Postgres and Redis in cluster.
- devstack mock for WorkOS/OIDC/LLM/Google.
- Infisical CLI export into `rowboat-api-secrets`.
- NodePort mappings for API and devstack.

The local kind path is not optional; any service-plane change touching auth,
OpenAPI, Temporal, or desktop IPC must keep `scripts/rowboat-api-kind.sh validate`
green.

## Observability

Required telemetry:

| Signal                | Notes                                                 |
| --------------------- | ----------------------------------------------------- |
| HTTP request metrics  | route, method, status, latency; no user labels.       |
| ent query metrics     | entity type and duration.                             |
| LLM usage rows        | model, tokens, use case, cost units, request id.      |
| quota logs            | reservation, settlement, refund, insufficient credit. |
| proxy upstream errors | provider, status/error class, request id.             |
| OpenAPI docs          | current generated API served by the app.              |

All logs must carry request id and user id where allowed, but metrics must not use
user, task, connector, or run ids as labels.

## Rollout

1. Keep WorkOS-direct as the production auth path.
2. Keep connector broker endpoints dark until RFC 012 lands.
3. Validate every route through kind before staging.
4. Enable cloud background-task routes per RFC 007, not through this RFC.
5. Promote staging to production only after smoke checks cover account, model
   list, one LLM stream, and desktop sign-in.

## Test plan

- Go handler tests for `/v1/config`, `/v1/me`, quota errors, and upstream proxy
  error envelopes.
- Race-enabled Go tests for ledger reservation/settlement idempotency.
- kind validation for health, ready, OpenAPI, docs, WorkOS/devstack login,
  `/v1/me`, and `/v1/llm/models`.
- Desktop smoke against kind with `API_URL=http://localhost:18080`.
- Helm lint/template for kind, staging, and production values.

## Detailed implementation design

### Package layout

The service plane should keep route ownership narrow and testable:

| Package                  | Responsibility                                                                 |
| ------------------------ | ------------------------------------------------------------------------------ |
| `internal/httpapi`       | Router setup, middleware ordering, response helpers, OpenAPI registration.     |
| `internal/authn`         | WorkOS JWT validation, devstack auth, internal service auth, actor extraction. |
| `internal/accounts`      | `/v1/me`, organization/account profile projection, billing status projection.  |
| `internal/configapi`     | `/v1/config`, desktop feature flags, runtime capability discovery.             |
| `internal/llmgateway`    | Model catalog, streaming completions, usage capture, gateway errors.           |
| `internal/credits`       | Reservations, settlements, refunds, account balance projection.                |
| `internal/googlebroker`  | Google OAuth refresh proxy and provider error normalization.                   |
| `internal/providerproxy` | Exa, voice, and future provider proxy wrappers.                                |
| `internal/apidocs`       | OpenAPI generation and docs route wiring.                                      |
| `internal/servicehealth` | Liveness/readiness checks and dependency state.                                |

Route packages should depend on small interfaces rather than ent clients
directly where business logic needs unit tests. ent can remain visible in
repository packages.

### Middleware order

HTTP middleware order must be stable because observability, auth, and tenant
scoping all depend on it:

1. request id creation or propagation
2. panic recovery
3. structured logging context
4. CORS, only on public browser-facing routes
5. body size limit
6. authentication
7. actor and tenant injection
8. entitlement/quota preflight where route-specific
9. route handler
10. response audit hook
11. metrics emission

Authentication must run before ent access. Any route that intentionally allows
anonymous access must be listed in a public-route allowlist with a comment
explaining why it is safe.

### Route contract

The v1 surface is intentionally small. New routes should be added only when the
desktop has a concrete workflow or another RFC names the route as a dependency.

| Method | Route                      | Auth                                   | Purpose                                                       |
| ------ | -------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| `GET`  | `/healthz`                 | public                                 | Process liveness. No dependency checks.                       |
| `GET`  | `/readyz`                  | public                                 | Dependency readiness for Kubernetes.                          |
| `GET`  | `/openapi.json`            | public or docs-auth                    | Generated API spec for clients and smoke tests.               |
| `GET`  | `/docs`                    | public in non-prod, restricted in prod | Human API docs.                                               |
| `GET`  | `/v1/config`               | WorkOS user                            | Desktop capability and endpoint config.                       |
| `GET`  | `/v1/me`                   | WorkOS user                            | Current user, org, billing, and entitlement projection.       |
| `GET`  | `/v1/llm/models`           | WorkOS user                            | Models available to the user and org.                         |
| `POST` | `/v1/llm/responses`        | WorkOS user                            | Non-streaming LLM response with quota enforcement.            |
| `POST` | `/v1/llm/responses:stream` | WorkOS user                            | Streaming LLM response with usage settlement.                 |
| `POST` | `/v1/google/refresh`       | WorkOS user                            | Refresh Google access through encrypted provider credentials. |
| `POST` | `/v1/exa/search`           | WorkOS user                            | Server-side Exa call with quota and provider policy.          |
| `POST` | `/v1/voice/*`              | WorkOS user                            | Voice provider proxy routes where local mode is not used.     |
| `GET`  | `/v1/background-tasks/*`   | WorkOS user                            | Existing/future cloud background task control plane.          |
| `POST` | `/v1/internal/*`           | internal service                       | Worker, scheduler, webhook, and invalidation hooks.           |

Routes that call providers must return provider-neutral errors. The client should
not need provider-specific parsing to decide retry, quota, auth, or permanent
failure behavior.

### Response envelope

Every JSON error response should have the same shape:

```json
{
  "error": {
    "code": "quota_insufficient",
    "message": "Not enough credits for this request.",
    "request_id": "req_123",
    "retryable": false,
    "details": {
      "minimum_required": 20
    }
  }
}
```

Rules:

- `code` is stable and documented.
- `message` is safe for display but not used for branching.
- `request_id` is always present.
- `retryable` is set by server policy, not guessed by the client.
- `details` may be omitted, but if present must not include secrets, provider
  tokens, raw prompts marked private, or PII not already visible to the user.

### `/v1/config`

The config response should be a capability contract, not a dump of server env:

```json
{
  "environment": "staging",
  "api_version": "2026-06-06",
  "features": {
    "cloud_background_tasks": true,
    "connector_broker": false,
    "local_transcription": true,
    "local_diarization_beta": false
  },
  "endpoints": {
    "llm": "/v1/llm",
    "background_tasks": "/v1/background-tasks",
    "connectors": "/v1/connectors"
  },
  "limits": {
    "max_prompt_bytes": 200000,
    "max_stream_seconds": 300
  }
}
```

The desktop uses this to hide unsupported controls. The API must still enforce
capabilities server-side even when an old desktop ignores the config.

### `/v1/me`

The account response should be a projection assembled from WorkOS identity,
local user rows, org mapping, and billing status:

```json
{
  "user": {
    "id": "usr_local",
    "workos_user_id": "user_123",
    "email": "user@example.com",
    "name": "User Example"
  },
  "organization": {
    "id": "org_local",
    "workos_organization_id": "org_123",
    "name": "Example Co"
  },
  "billing": {
    "plan": "pro",
    "credits_remaining": 12400,
    "status": "active"
  },
  "entitlements": {
    "cloud_background_tasks": true,
    "connector_broker": false,
    "voice_cloud": true
  }
}
```

If no organization exists, the response should include an onboarding-required
state instead of returning partial data that the desktop has to guess from.

### LLM gateway flow

LLM requests use a reservation/settlement pattern:

1. Validate actor and entitlement.
2. Estimate usage from input size, requested model, and max output.
3. Create a credit reservation row.
4. Call gateway/provider with request id propagated.
5. Stream chunks to the desktop when streaming.
6. Capture final usage when provider returns it.
7. Settle the reservation into a ledger debit.
8. Refund unused reservation if the request fails before provider execution.
9. Emit `llm.usage.recorded` audit event.

Streaming failure is settled using the best available usage. If no provider
usage is available, the settlement uses estimated input plus emitted output
tokens and marks the row `estimated=true`.

### Credit ledger schema

Credit rows are append-only. A minimal schema:

```text
CreditLedgerEntry
  id uuid
  user_id uuid
  organization_id uuid nullable
  source enum(purchase, grant, reservation, debit, refund, adjustment)
  amount integer
  balance_after integer nullable
  request_id string
  provider_request_id string nullable
  model string nullable
  use_case string
  metadata_json encrypted json
  created_at timestamp
```

Reservations are separate rows or a separate table, but they must have:

- idempotency key
- requested amount
- reserved amount
- status: `open`, `settled`, `refunded`, `expired`
- expiry timestamp
- settlement ledger entry id

No code path mutates historical debits. Corrections are new rows.

### Provider proxy rules

Provider proxy implementations must follow the same rules:

- never return provider API keys to clients
- attach request id to upstream metadata where supported
- normalize provider errors into Rowboat error codes
- enforce route-specific timeout
- cap response size
- record usage and cost when available
- redact prompts/payloads from logs by default

Provider-specific retry should happen only for errors that are known idempotent.
Streaming calls should not be retried automatically after bytes have reached the
client unless the protocol supports resumable streams.

### ent and tenant scoping

All user-owned entities must have one of:

- direct user edge
- organization edge plus membership check
- internal-only marker and explicit service actor

External request handlers must not call `auth.WithInternal(ctx)`. That context
is reserved for scheduler, worker, router, migration, and trusted internal
hooks. Tests should include a negative case showing that a normal user cannot
read another user's rows even when the id is known.

### Deployment artifacts

The chart should expose:

- server deployment
- optional worker deployment
- optional scheduler deployment from RFC 001
- service
- ingress or local NodePort values
- secret references
- ConfigMap for non-secret flags
- service monitor or Prometheus scrape annotations
- readiness probe on `/readyz`
- liveness probe on `/healthz`

The kind script should exercise the same chart with local values. Avoid a
parallel local-only YAML stack because it will drift from staging.

### Readiness checks

`/readyz` should report dependency-level status:

```json
{
  "status": "ok",
  "checks": {
    "database": "ok",
    "redis": "ok",
    "temporal": "disabled",
    "workos_jwks": "ok",
    "llm_gateway": "ok"
  }
}
```

Readiness may be `degraded` for optional dependencies that are feature-flagged
off. It must be `fail` for database unavailability.

### Backward compatibility

Desktop/API compatibility rules:

- Additive response fields are allowed.
- Removing fields requires a desktop minimum-version gate.
- New required request fields require a capability flag and client rollout.
- Error codes must not be repurposed.
- Routes should support at least one previous stable desktop version during
  staged rollout unless a security incident forces a hard cutover.

## Acceptance criteria

- Desktop can sign in, fetch account/credits, list models, stream an LLM call,
  and use Google refresh through rowboat-api.
- Credits are enforced server-side and all debits are auditable.
- User-owned rows are scoped by ORM interceptors.
- kind and Helm deploy paths stay aligned.
- The API service plane remains separate from product MCP traffic.

## Decisions

- **Live auth path: WorkOS-direct.** Hydra/Ory is deferred to RFC 011/012.
- **rowboat-api is a service plane, not an MCP proxy.** Product data access goes
  through product-owned MCP servers.
- **Credit accounting is append-only.** Corrections are new ledger rows, not
  mutations.
- **Kind is the required local integration gate.** It validates chart shape, secrets,
  OpenAPI, auth/devstack, and desktop API override behavior.
