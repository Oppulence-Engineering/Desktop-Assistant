# Rowboat Desktop Backend — Implementation Plan

> Companion to [BACKEND_API_SPEC.md](./BACKEND_API_SPEC.md) and [CONNECTOR_SUITE.md](./CONNECTOR_SUITE.md). The spec describes *what* the backend serves; this plan describes *how* and *in what order* it gets built; the connector suite describes the OAuth 2.0 protocol that links Robo to Canvas / Corinthian / Billflow.

## Architectural decisions (recap)

| Decision | Choice |
|---|---|
| Language | Go (use [stefanprodan/podinfo](https://github.com/stefanprodan/podinfo) as a scaffolding reference, not a fork) |
| HTTP framework | `chi` (matches podinfo) |
| ORM / migrations | [ent](https://entgo.io) — codegen-driven schema |
| Database | **DigitalOcean Managed Postgres** (own instance, not shared with Canvas) |
| Identity provider | **WorkOS AuthKit** (user identity: sign-in / sign-up / MFA only) |
| OAuth 2.0 authorization server | **Self-hosted Ory Hydra** via Ory's **official upstream Helm chart** (`ory/hydra` from `https://k8s.ory.sh/helm/charts`), deployed onto the org's existing Hetzner k3s clusters (`oppulence-infrastructure-as-code`). Our only artifact is a values file per environment in `charts/hydra/values-{production,staging}.yaml` — no wrapper chart. Federates login to WorkOS via OIDC. See [CONNECTOR_SUITE.md §17](./CONNECTOR_SUITE.md#17-operating-self-hosted-hydra-helm-on-hetzner-k3s) for ops. |
| Token verification (rowboat-api itself) | Go middleware verifies Ory-issued JWTs (audience `rowboat-api`) against Ory JWKS. Same library used by every other product. |
| Secrets at rest | `pgcrypto` (column-level) for OAuth refresh tokens + vendor-issued user creds |
| Vendor keys (pool) | Held in Infisical (matches Canvas pattern) |
| Observability | OpenTelemetry (OTLP) + structured `zap` logging |
| Deploy | **Helm chart on the org's Hetzner k3s clusters** (`oppulence-infrastructure-as-code`). Chart values + manifests live in this repo at `charts/rowboat-api/`, deployed via `helm upgrade --install rowboat-api ...` against the upstream chart pattern, same as how `charts/hydra/` works. Multi-region capable (US-East primary; replicas in US-West and EU-Central serve LLM gateway traffic to nearby users). |
| Repo placement | **Everything in this fork.** `apps/rowboat-api/` (Go backend), `apps/oauth-consent/` (consent UI), `packages/oauth-resource-server-go/`, `packages/oauth-resource-server-ts/`, `charts/hydra/`, `charts/rowboat-api/`. No cross-repo split. The TS resource-server library publishes to npm as `@oppulence/oauth-resource-server` when Canvas/Corinthian/Billflow need to import it; until then it lives here as the source of truth. |

The desktop reaches **two planes**:

1. **Service plane** — the Go backend in this plan. Owns billing, credits, OAuth secrets, vendor key pool, telemetry.
2. **Integration plane** — MCP servers per product. Desktop connects directly to each MCP. The Go backend only brokers the OAuth handshake and hands the desktop a fresh access token to use against each MCP.

```
┌────────────────────────────────────────────────────────────────────┐
│                          Rowboat Desktop                            │
│                         (apps/x, Electron)                          │
│                                                                     │
│   ┌──────────────────────┐         ┌──────────────────────────┐    │
│   │  /v1/* HTTPS calls   │         │   MCP client (stdio +    │    │
│   │  (config, billing,   │         │   SSE/HTTP transports)   │    │
│   │   LLM, voice, exa,   │         │                          │    │
│   │   composio, google)  │         │                          │    │
│   └──────────┬───────────┘         └────────┬─────────────────┘    │
└──────────────┼─────────────────────────────────┼───────────────────┘
               ▼                                 ▼
┌──────────────────────────────┐   ┌──────────────────────────────────┐
│   rowboat-api (Go, this plan)│   │   MCP servers (independent)      │
│                              │   │                                  │
│  • /v1/config                │   │  • Canvas MCP                    │
│  • /v1/me + billing          │   │    (oppulence-canvas/packages/   │
│  • /v1/llm/* (gateway)       │   │     api/src/mcp)                 │
│  • /v1/voice/tts             │   │  • Corinthian MCP                │
│  • /v1/search/exa            │   │    (oppulence-canvas/corinthian/ │
│  • /v1/composio/*            │   │     corinthian-mcp, 141 tools)   │
│  • /v1/google-oauth/*        │   │  • Wispr Flow MCP (new)          │
│  • /v1/connectors            │◄──┤  • (future connectors)           │
│  • /v1/connections/{name}/*  │   │                                  │
│                              │   │  All HTTP-transport, hosted.     │
│  Holds: user, credits,       │   │  Auth via short-lived bearer     │
│  ledger, OAuth refresh       │   │  tokens minted by rowboat-api.   │
│  tokens, MCP connections.    │   │                                  │
└─────────────┬────────────────┘   └──────────────────────────────────┘
              │
              ▼
     Postgres (own DB, ent schemas)
```

---

## Service plane: Go backend

### Repo & module layout

```
apps/rowboat-api/
├── cmd/
│   └── server/                       # main.go — wires deps, starts chi server
├── internal/
│   ├── auth/                         # Supabase JWT verification, JWKS cache
│   ├── billing/                      # plans, credit ledger, /me handler
│   ├── config/                       # /v1/config handler, app-level config
│   ├── connectors/                   # /v1/connectors + /v1/connections/* handlers
│   ├── composio/                     # /v1/composio/* reverse proxy + auth swap
│   ├── google/                       # /v1/google-oauth/{claim,refresh}
│   ├── llm/                          # /v1/llm/* gateway, provider router, SSE
│   ├── quota/                        # credit gate middleware, atomic decrement
│   ├── search/                       # /v1/search/exa
│   ├── secrets/                      # Infisical client wrapper (vendor key pool)
│   ├── telemetry/                    # OTel/zap setup, http+db instrumentation
│   ├── tokens/                       # short-lived MCP bearer issuance
│   └── voice/                        # /v1/voice/text-to-speech/{voiceId}
├── ent/                              # ent schemas → generated client
│   ├── schema/
│   │   ├── user.go
│   │   ├── subscription.go
│   │   ├── credit_ledger.go
│   │   ├── llm_usage.go
│   │   ├── oauth_pending.go
│   │   ├── oauth_connection.go
│   │   └── mcp_connection.go
│   └── generate.go                   # `go generate ./...` → ./ent
├── migrations/                       # atlas-generated, applied by entgo/atlas
├── api/
│   └── openapi.yaml                  # generated from chi routes for SDK gen
├── Dockerfile
├── fly.toml
├── Makefile                          # build, lint, test, ent-gen, migrate-diff
└── go.mod                            # module: github.com/Oppulence-Engineering/rowboat/apps/rowboat-api
```

### Tech stack rationale

- **chi** — minimal, idiomatic, plays well with `net/http` middleware. Same router style podinfo uses.
- **ent** — schema-as-Go-code, codegen, atlas-backed migrations, type-safe queries. Best Go ORM for greenfield work.
- **Atlas** — pairs with ent. `make migrate-diff` produces SQL migrations from schema changes.
- **OTel + zap** — `go.opentelemetry.io/otel` for traces, `go.uber.org/zap` for logs, both bridged to a single OTel collector.
- **Infisical** — vendor keys (OpenAI, Anthropic, ElevenLabs, Exa, Composio, Google OAuth client secret, ElevenLabs API key) pulled at boot, refreshed periodically. Matches Canvas's pattern.
- **Ory SDK** (`github.com/ory/client-go`) — admin API for client/audience/scope management at provisioning time.
- **WorkOS Go SDK** (`github.com/workos/workos-go`) — fetch user metadata when minting a local `User` row.
- **`oauth-resource-server` library** (in-house, see [CONNECTOR_SUITE.md §9](./CONNECTOR_SUITE.md#9-the-oauth-resource-server-libraries)) — JWT verification + scope enforcement. rowboat-api itself uses it, same as every other product.

### ent schema (concrete)

Translating the spec's storage model:

```go
// ent/schema/user.go
type User struct{ ent.Schema }
func (User) Fields() []ent.Field {
    return []ent.Field{
        field.UUID("id", uuid.UUID{}).Default(uuid.New),
        field.String("email").Unique(),
        field.String("workos_user_id").Unique(),                // `user_xxx` from WorkOS
        field.String("workos_org_id").Optional(),               // for B2B workspaces, if enabled
        field.Time("created_at").Default(time.Now).Immutable(),
        field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
    }
}
func (User) Edges() []ent.Edge {
    return []ent.Edge{
        edge.To("subscription", Subscription.Type).Unique(),
        edge.To("ledger_entries", CreditLedger.Type),
        edge.To("oauth_connections", OAuthConnection.Type),
        edge.To("mcp_connections", MCPConnection.Type),
    }
}

// ent/schema/subscription.go
type Subscription struct{ ent.Schema }
func (Subscription) Fields() []ent.Field {
    return []ent.Field{
        field.String("plan").Default("free"),                   // free | pro | team
        field.String("status").Default("active"),               // active | trialing | past_due | canceled
        field.Time("trial_expires_at").Optional().Nillable(),
        field.Int("sanctioned_credits").Default(10000),
        field.String("stripe_customer_id").Optional(),
        field.String("stripe_subscription_id").Optional(),
    }
}

// ent/schema/credit_ledger.go — append-only
type CreditLedger struct{ ent.Schema }
func (CreditLedger) Fields() []ent.Field {
    return []ent.Field{
        field.UUID("id", uuid.UUID{}).Default(uuid.New),
        field.Int("delta"),                                     // negative = consumption, positive = grant
        field.String("reason"),                                 // llm_call | voice_tts | exa_search | grant | refund
        field.UUID("request_id", uuid.UUID{}),                  // idempotency anchor
        field.Time("ts").Default(time.Now).Immutable(),
    }
}
func (CreditLedger) Indexes() []ent.Index {
    return []ent.Index{ index.Fields("request_id").Unique() }
}

// ent/schema/llm_usage.go
type LLMUsage struct{ ent.Schema }
func (LLMUsage) Fields() []ent.Field {
    return []ent.Field{
        field.UUID("id", uuid.UUID{}).Default(uuid.New),
        field.String("model"),
        field.String("use_case").Optional(),                    // x-rowboat-use-case
        field.String("sub_use_case").Optional(),                // x-rowboat-sub-use-case
        field.String("agent_name").Optional(),                  // x-rowboat-agent-name
        field.Int("input_tokens"),
        field.Int("output_tokens"),
        field.Int("cost_units"),                                // credits decremented
        field.UUID("request_id", uuid.UUID{}),
        field.Time("ts").Default(time.Now).Immutable(),
    }
}

// ent/schema/oauth_pending.go — ephemeral, used by Google claim flow
type OAuthPending struct{ ent.Schema }
func (OAuthPending) Fields() []ent.Field {
    return []ent.Field{
        field.String("state").Unique(),                         // ticket
        field.String("provider"),                               // google | canvas | corinthian | wispr
        field.Bytes("payload_encrypted"),                       // pgcrypto-sealed JSON
        field.Time("expires_at"),                               // 10 min TTL
    }
}

// ent/schema/oauth_connection.go — long-lived OAuth tokens (Google etc.)
type OAuthConnection struct{ ent.Schema }
func (OAuthConnection) Fields() []ent.Field {
    return []ent.Field{
        field.String("provider"),                               // google
        field.Bytes("refresh_token_encrypted"),
        field.Strings("scopes"),
        field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
    }
}
func (OAuthConnection) Indexes() []ent.Index {
    return []ent.Index{ index.Fields("provider").Edges("user").Unique() }
}

// ent/schema/mcp_connection.go — per-(user, product) OAuth state
type MCPConnection struct{ ent.Schema }
func (MCPConnection) Fields() []ent.Field {
    return []ent.Field{
        field.String("connector"),                              // canvas | corinthian | billflow | wispr
        field.String("audience"),                               // canvas-api | corinthian-api | ...
        field.Strings("scopes"),                                // granted scopes (subset of requested)
        field.Bytes("refresh_token_encrypted"),                 // Ory-issued, rotated on each use
        field.Time("connected_at").Default(time.Now),
        field.Time("last_used_at").Optional(),
        field.Time("expires_at"),                               // refresh token expiry
    }
}
func (MCPConnection) Indexes() []ent.Index {
    return []ent.Index{ index.Fields("connector").Edges("user").Unique() }
}
```

### Endpoint → handler mapping

| Endpoint | Package | Notes |
|----------|---------|-------|
| `GET  /v1/config` | `internal/config` | Static + Redis-cached for 5 min. |
| `GET  /v1/me` | `internal/billing` | Joins `User` + `Subscription`; `available_credits = sanctioned + SUM(ledger.delta)`. |
| `POST /v1/google-oauth/claim` | `internal/google` | Reads + deletes `OAuthPending`; persists `OAuthConnection`. |
| `POST /v1/google-oauth/refresh` | `internal/google` | Calls Google with client secret from Infisical. 409 on `invalid_grant`. |
| `POST /v1/llm/chat/completions` | `internal/llm` | Quota gate → provider router → SSE pass-through → write `LLMUsage`. |
| `GET  /v1/llm/models` | `internal/llm` | Static catalog (config-driven). |
| `POST /v1/voice/text-to-speech/{voiceId}` | `internal/voice` | Quota gate → proxy to ElevenLabs. |
| `POST /v1/search/exa` | `internal/search` | Quota gate → proxy to Exa. |
| `*    /v1/composio/*` | `internal/composio` | `httputil.ReverseProxy` with auth header swap. |
| `GET  /v1/connectors` | `internal/connectors` | Lists available products + per-user connection status + scopes catalog. |
| `POST /v1/connections/{name}/start` | `internal/connectors` | Generates state + PKCE, returns Ory `/oauth2/auth` URL. |
| `GET  /v1/connections/{name}/callback` | `internal/connectors` | OAuth callback. Exchanges code at Ory, stores refresh token in `MCPConnection`, deep-links desktop. |
| `POST /v1/connections/{name}/mcp-token` | `internal/connectors` | Returns cached access token or refreshes via Ory. |
| `DELETE /v1/connections/{name}` | `internal/connectors` | Revokes refresh token at Ory and deletes `MCPConnection`. |
| `POST /oauth-hooks/pre-consent` | `internal/connectors` | Webhook called by Ory before showing consent. Checks subscription entitlement, returns allow/upsell. See [CONNECTOR_SUITE.md §12](./CONNECTOR_SUITE.md#12-entitlement--subscription-gating). |
| `POST /v1/internal/connections/invalidate` | `internal/connectors` | Server-to-server endpoint; products call when a user should be force-disconnected. |

### Cross-cutting middleware (in chi order)

1. **`telemetry.Middleware`** — request_id, OTel span, zap fields.
2. **`oauthrs.Require(audience: "rowboat-api")`** — verify Ory-issued JWT against Ory JWKS (cached, refreshed on `kid` miss); decode claims; on first sight of a `workos_user_id` upsert the local `User`; attach `*ent.User` to ctx. Skipped only for `/v1/config` and `/oauth-hooks/*` (which use shared-secret HMAC).
3. **`quota.RequireCredits(estimatedCost)`** — short-circuit `402` if balance would go negative; passes a `ChargeFn` into the handler for the post-call ledger write.
4. **`rate_limit.PerUser`** — Redis token bucket per route group.

### Quota gate, in detail

The LLM gateway needs to decrement credits atomically. Pattern:

```go
// Pre-call: tentatively reserve. Decrement now, ledger reason "llm_call_reserve".
charge, err := quota.Reserve(ctx, userID, estimatedCost, requestID)
if err != nil { return err }                  // includes 402 case

// Stream the upstream call. Count tokens as they fly.
result, err := llm.Stream(ctx, req, ...)

// Post-call: settle. If actual < reserved, write a refund row; if actual > reserved, write a top-up debit.
if err != nil {
    charge.Refund(ctx, requestID)             // full refund
    return err
}
charge.Settle(ctx, requestID, actualCost)     // diff between estimate and actual
```

Both `Reserve` and `Settle` write to `CreditLedger` keyed by `request_id` (unique index → safe retries).

---

## Integration plane: MCP connectors

> See [CONNECTOR_SUITE.md](./CONNECTOR_SUITE.md) for the full protocol. Summary below.

The desktop's `apps/x/packages/core/src/mcp/` is already an MCP client (stdio + HTTP transports). Integration is:

1. The Go backend tells the desktop **which products exist + what scopes they expose** (`GET /v1/connectors`).
2. The Go backend brokers an **OAuth 2.0 PKCE flow against our self-hosted Hydra** at `oauth.solomon-ai.co`; the user grants scopes via the consent UI at `consent.solomon-ai.co`.
3. The Go backend stores the refresh token encrypted; on demand, mints fresh access tokens via Ory's `/oauth2/token`.
4. The desktop **calls each product's MCP directly** with the Ory-issued JWT. The product's resource-server middleware verifies the JWT and enforces per-tool scopes.

The Go backend does **not** proxy MCP traffic and does **not** hold per-product API keys. Each product trusts Ory directly. That keeps rowboat-api small and lets product MCP servers evolve independently.

### Connector registry shape

`GET /v1/connectors` →

```json
{
  "connectors": [
    {
      "name": "canvas",
      "displayName": "Canvas",
      "description": "Banking, invoicing, dunning, transactions",
      "mcpUrl": "https://api.canvas.solomon-ai.co/v1/mcp",
      "authType": "oauth",
      "scopes": ["invoices:read", "customers:read", "transactions:read", "..."],
      "iconUrl": "https://...",
      "connected": true,
      "connectedAt": "2026-01-15T..."
    },
    {
      "name": "corinthian",
      "displayName": "Corinthian",
      "description": "Accounts receivable, collections, communications",
      "mcpUrl": "https://api.corinthian.solomon-ai.co/v1/mcp",
      "authType": "api_key",
      "iconUrl": "https://...",
      "connected": false
    },
    {
      "name": "wispr",
      "displayName": "Wispr Flow",
      "description": "AI dictation transcripts",
      "mcpUrl": "https://mcp.wispr.solomon-ai.co/mcp",
      "authType": "api_key",
      "iconUrl": "https://...",
      "connected": false
    }
  ]
}
```

### Per-connector plan

#### Canvas (`oppulence-canvas/packages/api/src/mcp`)

- **Reuse**: it's already mounted at `/mcp` and `/v1/mcp` on the Canvas API. Accepts `Authorization: Bearer ...` (Supabase token) or `X-API-Key` plus optional `x-team-id`.
- **Auth flow**: OAuth-style. Since Canvas uses the same Supabase as us, this can be very cheap:
  1. Desktop → `POST /v1/connections/canvas/start` (returns `{ authorize_url }` pointing at Canvas app).
  2. User signs in to Canvas, grants access. Canvas app calls `POST /v1/connections/canvas/complete` on our backend with a one-time code.
  3. We exchange the code for a long-lived API key Canvas issues, store encrypted in `MCPConnection.api_key_encrypted`.
  4. On demand, `POST /v1/connections/canvas/mcp-token` returns a short-lived bearer the desktop uses against Canvas's `/v1/mcp`.
- **Tools exposed (from `packages/api/src/mcp/tools/`)**: `bank-accounts`, `customers`, `documents`, `inbox`, `invoices`, `reports`, `search`, `tags`, `team`, `tracker`, `transactions`.
- **Desktop work**: zero net-new; the MCP client already supports HTTP transport. Just point at the URL.

#### Corinthian (`oppulence-canvas/corinthian/corinthian-mcp`)

- **Reuse**: standalone HTTP MCP server, mountable at `/mcp` or `/v1/mcp` on the Corinthian API. 141 tools, with approval tokens for money-moving actions and dry-run support.
- **Auth flow**: same shape as Canvas (Supabase-shared SSO if Corinthian uses the same Supabase project, else OAuth code flow). The Corinthian MCP accepts `ck_live_...` API keys; we hold one per user in `MCPConnection.api_key_encrypted`.
- **Hardened path**: Corinthian's MCP supports a **policy file** (`corinthian-mcp.policy.json`) and **tool packs** (`--tool-pack ar`). The desktop should pull a policy from the connector registry (`policyUrl` field) and pass it on connect — so we can ship narrower tool surfaces to free-tier users.
- **Desktop work**: same as Canvas, but plus passing the policy/audit settings.

#### Wispr Flow (new)

- **Status**: Wispr Flow is third-party (wisprflow.ai). Public API status is unknown — needs verification before committing.
- **If Wispr Flow has a public API**:
  - Build `services/rowboat-connectors/wispr-mcp` (new Go service, or Node — Node MCP SDKs are more mature).
  - Tools: `wispr.list_transcripts`, `wispr.get_transcript`, `wispr.search`.
  - Auth: API key or OAuth, depending on Wispr's offerings.
- **If Wispr Flow has no API**:
  - Out of scope for the first cut. Defer until they ship one, or punt the integration to direct desktop-side scraping (not recommended — fragile).

#### Future connectors

Same shape: add a row to the connector registry, build (or wrap) an MCP server, run an OAuth flow, mint short-lived tokens. The registry is the only thing that ever has to change in the Go backend.

---

## End-to-end flows

### Flow A: First sign-in

```
1. Desktop opens, no stored tokens.
2. Desktop calls GET /v1/config → reads { oidcIssuerUrl }.
3. Desktop hits the WorkOS .well-known/openid-configuration to discover endpoints.
4. Desktop does Dynamic Client Registration (first launch only) and stores the
   client_id in its OAuth repo.
5. Desktop opens the AuthKit-hosted /authorize URL in the user's browser; PKCE.
6. AuthKit completes sign-in/sign-up, redirects to the desktop's loopback or
   custom-scheme callback with `code`.
7. Desktop exchanges code for access + refresh tokens at the WorkOS token endpoint.
8. Desktop calls GET /v1/me with the WorkOS access token.
9. Backend verifies JWT against WorkOS JWKS, upserts User on first sight,
   mints free-tier Subscription (10k credits), returns billing info.
10. Desktop unlocks signed-in features.
```

### Flow B: LLM call

```
1. Desktop builds OpenAI-shaped request, calls POST /v1/llm/chat/completions
   with bearer + x-rowboat-use-case headers.
2. Middleware: verify JWT → load user → reserve credits (estimated).
3. Handler: route by model.id → call upstream provider with streaming.
4. As tokens stream back, count and pipe to client as SSE.
5. On finish: write LLMUsage row + settle credit reservation.
```

### Flow C: Connect Canvas

```
1. Desktop calls GET /v1/connectors → sees Canvas, connected:false.
2. User clicks Connect → desktop calls POST /v1/connections/canvas/start.
3. Backend returns { authorize_url: "https://canvas.../oauth/authorize?..." }.
4. Desktop opens browser to that URL.
5. Canvas auths user, redirects to https://api.rowboat.../oauth/canvas/callback?code=...
6. Backend exchanges code for Canvas API key, stores encrypted in MCPConnection.
7. Desktop polls GET /v1/connectors → sees connected:true.
8. Desktop calls POST /v1/connections/canvas/mcp-token → gets short-lived bearer.
9. Desktop opens MCP HTTP transport to mcpUrl with that bearer.
10. AI agent in desktop now sees canvas.* tools alongside built-ins.
```

---

## Build order

Each milestone is a working deployment. The desktop should be usable against this backend after Milestone 2.

| # | Milestone | What ships |
|---|-----------|-----------|
| 0 | **Scaffold** | `apps/rowboat-api/` created in this repo. chi server boots. OTel + zap wired. Health checks. **Helm values at `charts/rowboat-api/` deploy to the US-East k3s cluster** via the existing IaC tooling. ent generates empty client. Managed Postgres database provisioned (provider per IaC repo). **WorkOS project created, one OIDC client registered in the AuthKit dashboard, `client_id` recorded as a build-time secret. JWKS endpoint reachable.** |
| 1 | **Auth + identity** | `auth.RequireWorkOSJWT` middleware (JWKS cache, kid-miss refresh). `GET /v1/config` returns `{ appUrl, oidcIssuerUrl, websocketApiUrl }`. `GET /v1/me` upserts `User` from JWT claims and returns a hardcoded free-tier subscription. `User` and `Subscription` schemas live. **Two-line patch to `apps/x/packages/core/src/auth/providers.ts`**: (a) set the rowboat issuer to the WorkOS issuer URL (drop the Supabase-shaped `/auth/v1/` discovery path), (b) flip `client: { mode: 'dcr' }` to `client: { mode: 'static', clientId: '<workos-client-id>' }`. |
| 2 | **LLM gateway (single provider)** | `POST /v1/llm/chat/completions` with streaming for `anthropic/*` models. `GET /v1/llm/models` returns a static catalog. Quota gate active. `CreditLedger` + `LLMUsage` writes. **At this point the desktop is usable** with rate-limited free-tier access. |
| 3 | **More providers** | Add `openai/*`, `google/*`, `openrouter/*` routes. Per-model pricing table. |
| 4 | **Stripe billing** | Stripe webhook handler. Subscription state syncs to DB. Top-up purchases credit the ledger. Paywall behavior: `402` when balance hits zero. |
| 5 | **Voice + Exa** | `POST /v1/voice/text-to-speech/{voiceId}` proxies ElevenLabs. `POST /v1/search/exa` proxies Exa. Both with quota. |
| 6 | **Google OAuth broker** | `POST /v1/google-oauth/{claim,refresh}`. Requires webapp side to also exist (parks tickets in `OAuthPending`). Refresh token encryption via pgcrypto. |
| 7 | **Composio proxy** | `httputil.ReverseProxy` for all `/v1/composio/*` routes. Swap user bearer → vendor `x-api-key`. Scope-check connected accounts per user. |
| 8 | **Hydra + consent UI live** | `helm install hydra ory/hydra` deployed to US-East k3s cluster with our values file at `charts/hydra/values-production.yaml`. Custom domain `oauth.solomon-ai.co` via the existing NGINX ingress + cert-manager. `hydra` database in managed Postgres. WorkOS wired as OIDC IDP via the consent UI's `/login` path. Consent UI app at `consent.solomon-ai.co` (`apps/oauth-consent`, its own chart). `rowboat-desktop` OAuth client provisioned via standalone Job manifest at `charts/hydra/clients/rowboat-desktop.yaml`. `MCPConnection` schema live. `/v1/connectors`, `/v1/connections/{name}/{start,callback,mcp-token}`, `/oauth-hooks/pre-consent`, `/v1/internal/connections/invalidate` all live on rowboat-api. |
| 8.5 | **`oauth-resource-server` libraries** | Go (`packages/oauth-resource-server-go`) and TS (`packages/oauth-resource-server-ts`) libraries shipped. Scope catalog JSON committed to `CONNECTOR_SUITE.md`. |
| 9 | **Canvas connector** | Canvas API embeds TS resource-server middleware. MCP tools tagged with scopes per `CONNECTOR_SUITE.md §5`. Canvas's `/v1/internal/entitlements` endpoint live. Desktop end-to-end works against Canvas. |
| 10 | **Corinthian connector** | Same as Canvas. Money-moving approval flow standardized per `CONNECTOR_SUITE.md §10`. |
| 10.5 | **Billflow connector** | Same as Canvas. Approval-token flow for `billflow:approvals.execute` and `billflow:payments.execute`. |
| 11 | **Wispr Flow connector** | *Pending Wispr Flow API verification.* If feasible: new MCP server in Node, deployed under `mcp.wispr.solomon-ai.co`, slotted into the same OAuth protocol. |

Milestones 0–2 unblock the desktop entirely. The rest is incremental capability.

---

## Open questions to resolve before Milestone 0

1. **Vendor key pool.** Where does the Anthropic/OpenAI/ElevenLabs/Exa key set actually live and who owns rotation? Infisical is the recommended home (matches Canvas) — confirm we have a workspace.
2. **Pricing model.** Per-token rates for each provider, voice character rate, Exa per-query rate. Need product input before Milestone 4.
3. **Wispr Flow API access.** Does it have a public/partner API at all? If not, defer Milestone 11. (Grep confirmed: zero internal references anywhere in the org.)
4. **Cross-product auth for Canvas + Corinthian MCPs.** Canvas's MCP accepts `Authorization: Bearer` or `X-API-Key`. The token issued by our self-hosted Hydra is what these MCPs should ultimately accept — each product embeds `packages/oauth-resource-server-ts` and verifies tokens against our Hydra JWKS. See [CONNECTOR_SUITE.md §9](./CONNECTOR_SUITE.md#9-the-oauth-resource-server-libraries).
5. **Domain / DNS.** What hostnames will `rowboat-api`, `canvas-mcp`, `corinthian-mcp`, and the WorkOS-issued tokens belong to? Suggest:
   - `api.x.solomon-ai.co` (or `api.rowboat.solomon-ai.co`) — the Go backend
   - `auth.solomon-ai.co` — WorkOS AuthKit (custom domain on WorkOS)
   - `api.canvas.solomon-ai.co/v1/mcp` — Canvas MCP (already there)
   - `mcp.corinthian.solomon-ai.co/mcp` — Corinthian MCP standalone
   - `mcp.wispr.solomon-ai.co/mcp` — future Wispr Flow MCP

---

## Out of scope (intentionally)

- **Direct DB access to Canvas/Corinthian data.** Desktop sees their data through MCP tools only. No cross-database joins. No shared schema.
- **MCP traffic proxying through the Go backend.** Desktop talks to MCP servers directly. The backend only brokers auth.
- **Rebuilding what Canvas/Corinthian already expose.** If Canvas adds a new tool to its MCP, the desktop sees it without backend changes.
- **Schema migration of legacy Rowboat (`apps/rowboat`).** Different product, different code path. Not touched by this plan.
