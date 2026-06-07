# RFC 011: Identity and Authorization Plane

|                  |                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RFC**          | 011                                                                                                                                                                                              |
| **Status**       | Draft                                                                                                                                                                                            |
| **Track**        | Identity, authorization, and token boundaries                                                                                                                                                    |
| **Owners**       | `apps/rowboat-api`, `apps/x`, Platform                                                                                                                                                           |
| **Created**      | 2026-06-06                                                                                                                                                                                       |
| **Last updated** | 2026-06-06                                                                                                                                                                                       |
| **Depends on**   | WorkOS AuthKit, rowboat-api service plane                                                                                                                                                        |
| **Enables**      | [RFC 012](./012-connector-suite-and-consent-broker.md), [RFC 013](./013-oppulence-product-connector-fabric.md), future self-hosted tier                                                          |
| **Parent docs**  | [`docs/BACKEND_DEPLOYMENT.md`](../../docs/BACKEND_DEPLOYMENT.md), [`docs/IMPLEMENTATION_PLAN.md`](../../docs/IMPLEMENTATION_PLAN.md), [`docs/CONNECTOR_SUITE.md`](../../docs/CONNECTOR_SUITE.md) |

## Summary

The docs currently describe two identity postures:

- **Live path:** Rowboat Desktop signs into WorkOS AuthKit directly; rowboat-api
  validates WorkOS-issued access tokens.
- **Deferred broker path:** Ory Hydra issues OAuth2 authorization tokens for
  cross-product resources, federating human login to WorkOS.

Both are valid, but they serve different jobs. This RFC makes that split
intentional: WorkOS owns human identity now; Hydra/Ory is introduced only when we
need a self-controlled OAuth authorization server for product connectors,
fine-grained audiences, or a self-hosted sovereignty tier.

## Current state

| Fact                                                | Source                                                       |
| --------------------------------------------------- | ------------------------------------------------------------ |
| WorkOS-direct is the deployment posture             | `docs/BACKEND_DEPLOYMENT.md`                                 |
| Hydra artifacts remain in the tree but are deferred | `apps/oauth-consent`, `charts/hydra`, `charts/oauth-consent` |
| Connector suite still specifies Hydra as issuer     | `docs/CONNECTOR_SUITE.md`                                    |
| Implementation plan includes Ory/Hydra assumptions  | `docs/IMPLEMENTATION_PLAN.md`                                |

The conflict is mostly temporal: implementation docs captured a future connector
broker state; deployment docs captured the simpler live state. This RFC defines
the transition boundary.

## Goals

- Keep user sign-in simple and production-ready today.
- Avoid deploying Hydra before it is needed.
- Define exactly which tokens rowboat-api accepts in each mode.
- Preserve a clean future path for product-scoped OAuth consent.
- Avoid confusing identity (who the user is) with authorization (what a client may
  access in a product).

## Non-Goals

- Replacing WorkOS as the human identity provider.
- Implementing the consent UI; see RFC 012.
- Implementing hosted `apps/rowboat` FGA migration; see RFC 015.
- Designing A2A identity; see RFC 018.

## Terminology

| Term                | Meaning                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| Human identity      | The WorkOS user and optional WorkOS organization membership.            |
| Service-plane token | Token accepted by rowboat-api for `/v1/*` service routes.               |
| Resource token      | Audience-bound token accepted by a product MCP/API server.              |
| Broker mode         | Hydra/Ory issues resource tokens after WorkOS-backed login and consent. |
| WorkOS-direct mode  | Desktop gets tokens directly from WorkOS and calls rowboat-api.         |

## Mode A: WorkOS-direct (current production)

Flow:

1. Desktop fetches `GET /v1/config`.
2. Desktop discovers WorkOS/AuthKit issuer.
3. Desktop runs PKCE against WorkOS as a public client.
4. Desktop calls rowboat-api with `Authorization: Bearer <workos access token>`.
5. rowboat-api validates WorkOS JWTs, upserts local users, and scopes ent queries.

Accepted by rowboat-api:

| Claim               | Required                    |
| ------------------- | --------------------------- |
| `iss`               | WorkOS issuer/custom domain |
| `sub`               | WorkOS user id              |
| `exp`, `nbf`, `iat` | standard validation         |
| organization claim  | optional; used when present |

WorkOS-direct is sufficient for:

- Account and billing surfaces.
- LLM/voice/search/Composio proxying.
- Google OAuth refresh.
- Background-task API routes.
- Local kind/devstack validation.

## Mode B: Hydra/Ory broker (deferred)

Hydra/Ory becomes active when Rowboat needs one or more of:

- Product-scoped audiences (`canvas-api`, `corinthian-api`, `billflow-api`).
- Consent screens with optional scopes and trust tiers.
- Refresh token lifecycle owned by rowboat-api, not by the desktop.
- A self-hosted sovereignty tier requiring a self-controlled OAuth2 AS.
- Standard OAuth resource-server middleware across first-party products.

Flow:

1. Desktop is already signed in as a WorkOS user.
2. Desktop starts a connector flow through rowboat-api.
3. rowboat-api generates state + PKCE and redirects to Hydra.
4. Hydra delegates login to WorkOS when no session exists.
5. Consent UI grants product scopes.
6. rowboat-api stores encrypted refresh token in `MCPConnection`.
7. Desktop requests short-lived resource tokens for direct MCP calls.
8. Product MCP verifies Hydra JWT by issuer, audience, scope, and expiry.

Hydra/Ory resource tokens are accepted by product resource servers. They are not
required for normal rowboat-api service routes while WorkOS-direct remains active.

## Token acceptance matrix

| Caller          | Route group                        | Current accepted token               | Future broker token                                                               |
| --------------- | ---------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| Desktop         | `/v1/config`                       | none                                 | none                                                                              |
| Desktop         | rowboat-api `/v1/*` service routes | WorkOS access token                  | WorkOS token, optionally Ory `aud=rowboat-api` only after broker mode is promoted |
| Desktop         | product MCP routes                 | product-specific legacy auth or none | Ory resource token with product audience                                          |
| Product backend | `/v1/internal/*`                   | internal shared secret               | internal shared secret or signed service token                                    |
| Hydra/Ory       | `/oauth-hooks/*`                   | not enabled                          | HMAC/shared-secret webhook                                                        |

## User and org identity

Canonical identifiers:

| Identity                  | Canonical source                                    |
| ------------------------- | --------------------------------------------------- |
| Human user id             | WorkOS user id                                      |
| Human email/name          | WorkOS profile, mirrored locally                    |
| Organization id           | WorkOS organization id when available               |
| Product workspace/team id | Product-owned mapping through connector install     |
| Local database user id    | rowboat-api UUID, never exposed as cross-product id |

Product resource tokens should carry WorkOS user/org identifiers in an extension
claim. Resource servers must map those IDs to their own product tenants before
authorizing reads or writes.

## Service-to-service identity

First-party backend calls should not use human refresh tokens. The baseline is:

- Internal shared secret for current webhook/internal endpoints.
- Signed service tokens or client credentials when connector volume grows.
- No raw vendor/provider tokens in prompts, logs, or desktop config.

Service-to-service auth is a separate concern from user-delegated product access.

## Step-up and high-risk access

WorkOS is the step-up authority. The policy is:

| Scope/action tier            | Step-up required                                            |
| ---------------------------- | ----------------------------------------------------------- |
| read                         | no                                                          |
| write                        | no by default; product may require                          |
| external-effect send/trigger | extra confirmation in consent UI                            |
| money-moving                 | WorkOS MFA during consent and per-invocation approval token |

The approval-token part is enforced by product MCP servers, not by rowboat-api.

## Migration plan

1. **Now:** keep WorkOS-direct for rowboat-api.
2. **RFC 012 implementation:** add connector broker tables/endpoints dark.
3. Provision Hydra/Ory only in staging when Canvas/Corinthian/Cadence connector
   integration requires resource tokens.
4. Add TS/Go resource-server middleware to products.
5. Enable a single product connector in staging.
6. Promote connector broker mode to production without changing normal
   rowboat-api service auth.
7. Revisit whether rowboat-api should accept Ory `aud=rowboat-api` tokens only
   after connector broker mode is stable.

## Failure modes

| Failure                                  | Behavior                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| WorkOS outage                            | Signed-in API requests fail at token refresh/sign-in; existing valid tokens work until expiry. |
| Hydra unavailable                        | Connector start/token refresh fails; rowboat-api service routes keep working.                  |
| Product resource-server JWKS cache stale | Refetch on `kid` miss; deny if still invalid.                                                  |
| User loses product subscription          | Product or broker invalidates connection per RFC 012.                                          |
| Org mismatch                             | Product resource server denies; rowboat-api does not guess tenant mapping.                     |

## Observability

Required audit events:

- `auth.token.accepted`
- `auth.token.rejected`
- `auth.user.upserted`
- `auth.org.mapped`
- `connector.broker.started`
- `connector.resource_token.minted`
- `connector.token.revoked`

Metrics must label by bounded dimensions only: issuer type, route group, and
rejection reason. Never label by user id or org id.

## Test plan

- Unit tests for WorkOS JWT validation and `kid` cache refresh.
- Unit tests for rejected issuer/audience/expiry cases.
- kind/devstack auth smoke for WorkOS-direct sign-in.
- Staging-only broker smoke once Hydra is provisioned: connector start -> consent
  -> callback -> MCP token -> product resource-server verification.
- Negative tests for org mismatch and missing scope.

## Detailed implementation design

### Actor extraction

Every authenticated request resolves to one actor object. Handlers do not parse
raw JWT claims directly:

```go
type Actor struct {
    Kind           ActorKind
    UserID         uuid.UUID
    WorkOSUserID   string
    OrganizationID *uuid.UUID
    WorkOSOrgID    string
    ServiceName    string
    Scopes         []string
    Permissions    []string
    TokenIssuer    string
    TokenID         string
}
```

Actor kinds:

- `user`
- `service`
- `connector_resource`
- `widget`
- `internal`

`internal` is not derived from a public token. It is installed only by trusted
process entrypoints after local service authentication succeeds.

### Token validation algorithm

For every bearer token:

1. Parse header and claims without trusting them.
2. Select issuer configuration by `iss`.
3. Reject unknown issuer.
4. Resolve JWKS by issuer and `kid`.
5. Verify signature and algorithm allowlist.
6. Verify `exp`, `nbf`, and acceptable clock skew.
7. Verify audience.
8. Verify token type or authorized party when provider supplies it.
9. Verify org claim when the route requires an org.
10. Map provider subject to local user/service/connector actor.
11. Attach actor to context.
12. Emit accepted/rejected audit event with bounded reason.

No route gets a "best effort" actor from an invalid token. Validation fails
closed.

### Claim contracts

#### WorkOS user token

Required:

```json
{
  "iss": "https://api.workos.com/...",
  "sub": "user_123",
  "aud": "rowboat-api",
  "exp": 1770249600,
  "org_id": "org_123"
}
```

Optional:

- email
- name
- organization role
- permissions
- session id
- authentication method references

If the token lacks `org_id`, the API may allow only routes that do not require
tenant data. Any route that touches user data should require explicit org
selection once orgs are enabled.

#### Service token

Required:

```json
{
  "iss": "rowboat-internal",
  "sub": "service:scheduler",
  "aud": "rowboat-api",
  "scope": ["background_task:start"],
  "exp": 1770249600
}
```

Service tokens must be short-lived and scoped. Long-lived static shared secrets
are acceptable only for local devstack mode and must not be enabled in
production.

#### Broker/resource token

Required:

```json
{
  "iss": "rowboat-broker",
  "sub": "user_123",
  "aud": "mcp:canvas",
  "scope": ["canvas.read", "canvas.watch"],
  "connection_id": "conn_123",
  "org_id": "org_123",
  "exp": 1770249600
}
```

Product resource servers verify this token themselves. They should not call
rowboat-api synchronously on every request unless an introspection mode is
explicitly chosen.

### Authorization middleware

Authentication proves who the caller is. Authorization proves they can do this
specific thing. Route handlers should declare policy next to route registration:

```go
router.GET("/v1/llm/models", requireAuth(), requireEntitlement("llm"), listModels)
router.POST("/v1/internal/schedule/start", requireServiceScope("background_task:start"), startRun)
```

Policy helpers:

- `requireUser()`
- `requireOrg()`
- `requireEntitlement(name)`
- `requirePermission(permission)`
- `requireServiceScope(scope)`
- `requireConnectorScope(scope)`
- `requireStepUp(level)`

High-risk checks should be explicit and auditable. Avoid generic `admin=true`
branching.

### Org mapping

Local organization mapping has to handle these cases:

| Case                              | Behavior                                                          |
| --------------------------------- | ----------------------------------------------------------------- |
| Known WorkOS org                  | Load local org by `workos_organization_id`.                       |
| New WorkOS org                    | Create local org during user sync if route allows onboarding.     |
| User switched org                 | Update session projection and use selected org for tenant checks. |
| Token org not in local membership | Refresh WorkOS membership once, then deny if still missing.       |
| Product tenant mapping missing    | Deny product connector flow and ask user/admin to map tenant.     |

The API should not infer product tenant identity from matching display names.

### Step-up policy

Step-up requirements are route or action scoped:

| Action                        | Step-up requirement                           |
| ----------------------------- | --------------------------------------------- |
| View account/profile          | none                                          |
| Create connector read grant   | current WorkOS session                        |
| Grant watch/event scopes      | current WorkOS session, recent auth preferred |
| Grant send/trigger scope      | recent auth or MFA depending org policy       |
| Money-moving action proposal  | recent auth                                   |
| Money-moving action execution | MFA or dual-review approval token             |
| Rotate org/service key        | MFA                                           |
| Export audit log              | MFA or admin role                             |

Recent auth windows should be short, for example 10 to 15 minutes, and encoded
as policy not UI convention.

### Session and revocation behavior

Token revocation is provider-dependent, so the API needs layered controls:

- accept valid WorkOS access tokens until expiry
- force revalidation on sensitive actions
- maintain local denied token ids for emergency revocation when token id exists
- invalidate local sessions on account disable/deletion webhook
- revoke connector grants independently from sign-in sessions
- clear desktop cached auth state when `/v1/me` returns account disabled

The identity system must not rely on desktop logout for security.

### Broker-mode boundary

Hydra/Ory broker mode is introduced only for resource authorization. It does not
replace WorkOS as the human identity provider.

Broker responsibilities:

- convert WorkOS user/org identity into connector consent sessions
- mint resource-server tokens with product audience
- rotate refresh tokens
- emit connector audit events
- support revocation and invalidation

Broker non-responsibilities:

- primary login
- MFA user experience
- hosted platform AuthKit
- product RLS internals
- desktop local auth

### Migration invariants

During the WorkOS-direct to broker-capable transition:

- Existing desktop sign-in must keep working.
- `/v1/me` shape must remain compatible or capability-gated.
- Connector grant creation can be dark-launched with no desktop UI.
- Product MCP servers can verify broker tokens before real users are routed.
- A failed broker rollout must not disable normal rowboat-api service routes.

### Audit event payloads

Auth audit events should include:

```json
{
  "event": "auth.token.rejected",
  "request_id": "req_123",
  "issuer_type": "workos",
  "audience": "rowboat-api",
  "reason": "expired",
  "route_group": "llm",
  "created_at": "2026-06-06T12:00:00Z"
}
```

Do not log raw token, refresh token, auth code, PKCE verifier, or full claims
payload.

### Compatibility matrix

| Client                | Mode A WorkOS-direct                        | Mode B broker-capable                                                 |
| --------------------- | ------------------------------------------- | --------------------------------------------------------------------- |
| Desktop app           | Uses WorkOS token for service-plane routes. | Same for service-plane routes; uses broker only for connector grants. |
| Product MCP server    | Not involved.                               | Verifies broker/resource tokens.                                      |
| Hosted platform       | Uses RFC 015 WorkOS AuthKit path.           | Unchanged unless it consumes connector broker later.                  |
| Scheduler/worker      | Uses internal service auth.                 | Same.                                                                 |
| External integrations | Not accepted unless route-specific.         | May receive resource tokens only after explicit consent.              |

## Acceptance criteria

- The docs no longer imply Hydra is required for current desktop sign-in.
- rowboat-api has a clear token acceptance policy.
- Product-scoped OAuth can be introduced without disrupting service-plane auth.
- WorkOS remains the canonical human identity source.
- Resource servers do not trust rowboat-api checks alone.

## Decisions

- **WorkOS is identity.** It owns login, MFA, users, and org membership.
- **Hydra/Ory is authorization broker only when needed.** It is not on the critical
  path for the current backend.
- **One human, many resource grants.** Disconnecting Canvas must not affect the
  user's Rowboat sign-in or other connectors.
- **Product tenants remain product-owned.** Rowboat carries mappings; it does not
  collapse product RLS into one global tenant id.
