# Rowboat Desktop Backend — Implementation Plan

> Companion to [CONNECTOR_SUITE.md](./CONNECTOR_SUITE.md). This plan describes *what* the Rowboat desktop backend (`apps/rowboat-api`) serves, *how* it is built, and *in what order*. The connector suite describes the OAuth 2.0 protocol that links Robo to Canvas / Corinthian / Billflow.
>
> The backend replaces `https://api.x.rowboatlabs.com` — the closed hosted backend the upstream desktop currently uses. The endpoint surface is derived from every `API_URL` call site in `apps/x/packages/core/src/`. If the desktop adds a new call, [§Endpoint specification](#endpoint-specification) needs an update.

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
│   ├── auth/                         # Ory JWT verification via oauth-resource-server-go, JWKS cache
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

### Bootstrapping from podinfo

**Clone the podinfo template into `apps/rowboat-api` and build off of it.** podinfo is a production-grade Go microservice template; we take the whole thing as our starting point rather than re-deriving the service skeleton by hand. Clone it in place, detach it from podinfo's git history so it becomes our code, then strip the demo surface and build our endpoints on top of the operational scaffolding it ships with (Dockerfile, OTel wiring, structured logging, health probes, Prometheus metrics, chi routing patterns, Makefile). The business logic is ours; the scaffolding is podinfo's.

#### One-time clone procedure

```bash
# In the rowboat fork — clone the podinfo template directly into place
git clone https://github.com/stefanprodan/podinfo apps/rowboat-api
rm -rf apps/rowboat-api/.git          # detach from podinfo's history — this is our code now
git add apps/rowboat-api              # stage the cloned template in the fork
```

After this, `apps/rowboat-api/` is the full podinfo template living as a normal Go module in our tree — no submodule, no upstream sync, no podinfo dependency. We build directly on the cloned scaffolding: rename the module, delete the demo surface (see [What we delete from podinfo](#what-we-delete-from-podinfo)), and mount our own routes (see [What we tune / add on top](#what-we-tune--add-on-top)). Future podinfo changes don't flow in automatically; we cherry-pick if we want.

#### What we keep from podinfo

| Piece | Why |
|-------|-----|
| `Dockerfile` (multi-stage, distroless base) | Production-grade, small images, non-root user — better than what we'd write from scratch. |
| `Makefile` targets (`build`, `test`, `run`, `docker-build`) | Consistent dev experience matching other Go services. |
| `pkg/server` HTTP scaffold (chi router, middleware chain, graceful shutdown, write/read timeouts) | We're going to rebuild routes, but the server lifecycle is identical. |
| `pkg/logger` (zap config with JSON output, level wiring from env) | Wired to OTel collector via stdout — exactly what we want. |
| Health endpoints (`/healthz`, `/readyz`) | Probes already wired to chi middleware. K3s ingress consumes them. |
| Prometheus metrics scaffold (`/metrics` on a separate port) | Cluster already has Prometheus scrape config; this just slots in. |
| OpenTelemetry initialization (`pkg/telemetry`) | OTLP exporter, propagation, sampler config. We extend the resource attributes with our service metadata. |
| `pkg/version` (build-time version stamping via ldflags) | Releases are reproducible from a git SHA. |
| Graceful shutdown (signal handling, context cancellation, in-flight request draining) | One less subtle thing to get wrong. |
| `.dockerignore` and `.gitignore` | Sensible defaults. |
| CI workflow shape (lint → test → build → image push) | Used as a template for our GitHub Actions or Buildkite step. |

#### What we delete from podinfo

| Piece | Why drop it |
|-------|-------------|
| `pkg/api/` demo handlers (`/api/info`, `/env`, `/headers`, `/version`, `/store`, `/echo`) | They're demos. We have our own endpoints. Delete entirely. |
| `pkg/grpc` and the gRPC server | We don't need gRPC. The Rowboat desktop speaks HTTP/JSON and SSE. |
| `pkg/cache` Redis demo middleware | We use Redis for rate-limit token buckets, not response caching. Different shape — write our own. |
| Chaos endpoints (`/panic`, `/status/{code}`, `/delay`) | Useful for k8s teaching demos, not production. |
| `pkg/watchdog` | podinfo's signal-handling demo. Our shutdown is already covered by chi's graceful shutdown. |
| `pkg/swagger` and embedded UI | We'll generate OpenAPI from chi routes; no need for podinfo's swagger UI. |
| podinfo branding (banner ASCII, default tag line, `/api/info` "podinfo" string) | Replace with our service name. |
| podinfo's Kubernetes operator/CRDs and Flagger demo | Out of scope. |
| Custom HTTP backends for the demo (S3-compatible store, Redis store demo) | Demo features. Delete. |

#### What we tune / add on top

| Tuning | Detail |
|--------|--------|
| Router replacement | Strip podinfo's chi handlers, mount our own under `internal/{config,billing,llm,...}`. Keep podinfo's middleware order (request-id → recoverer → logger → otel) as a baseline. |
| ent + Atlas integration | Add `ent/` directory with our schemas. `make ent` runs `go generate ./ent`. `make migrate-diff` produces Atlas migrations. None of this exists in podinfo. |
| Postgres connection pool | Add `internal/db` wrapping `pgx/v5` with the ent driver. podinfo has no persistence. |
| Infisical client | Boot-time secret fetch + periodic refresh. New `internal/secrets` package. |
| WorkOS Go SDK + Ory client wiring | `internal/auth` uses `oauth-resource-server-go` to verify Ory tokens; on first sight upserts a local `User` via WorkOS SDK enrichment. |
| LLM gateway with SSE pass-through | New `internal/llm` package. podinfo has no streaming concept; we add the SSE relay pattern. |
| Reverse-proxy handlers (Composio, Exa, Voice) | New packages using `httputil.ReverseProxy` with header swap. |
| Webhook handlers (`/oauth-hooks/pre-consent`, `/v1/internal/connections/invalidate`) | Shared-secret HMAC verification middleware. Separate from the JWT-auth middleware chain. |
| Helm chart at `charts/rowboat-api/` | podinfo ships its own chart. We don't reuse it (different requirements — different env vars, secrets, ingress, service ports). Write our own values + deploy via the same pattern as `charts/hydra/`. |
| Dockerfile tag | Change `EXPOSE 9898` (podinfo default) to our port. Strip podinfo's signing/sbom artifacts; we'll add our own. |
| Module path | `go.mod` module is `github.com/Oppulence-Engineering/rowboat/apps/rowboat-api`, not `github.com/stefanprodan/podinfo`. Find/replace all imports. |
| License header | podinfo is Apache 2.0; vendored files keep that license + attribution. New files we write are under the rowboat fork's license. |

#### Sanity check: end-of-bootstrap state

After the cherry-pick and the tuning, `apps/rowboat-api/` should:

- Compile via `go build ./...`
- Pass `go vet ./...` and `golangci-lint run`
- Boot via `go run ./cmd/server` and respond on `/healthz` and `/readyz` with 200s
- Emit a single OTel span per request and structured JSON logs to stdout
- Have zero references to `stefanprodan/podinfo` in any non-attribution file

That's Milestone 0 done. Endpoints come in subsequent milestones (see [Build order](#build-order)).

### Tech stack rationale

- **chi** — minimal, idiomatic, plays well with `net/http` middleware. Same router style podinfo uses.
- **ent** — schema-as-Go-code, codegen, atlas-backed migrations, type-safe queries. We use it for more than just CRUD: hooks (write-side middleware), interceptors (read-side middleware), privacy policies (security-boundary enforcement at the ORM layer), and mixins (DRY base fields). Full feature list: [entgo.io/docs](https://entgo.io/docs/getting-started). See [ent capabilities we're leveraging](#ent-capabilities-were-leveraging) for concrete patterns + the extensions we explicitly defer.
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

### ent capabilities we're leveraging

ent ships a lot more than schema + migrations. The features below pull weight in rowboat-api; the ones at the bottom we explicitly defer.

#### Mixins — DRY the base fields

Most schemas share `id`, `created_at`, `updated_at`. Extract via a [mixin](https://entgo.io/docs/schema-mixin/):

```go
// ent/schema/mixin/base.go
package mixin

import (
    "time"
    "entgo.io/ent"
    "entgo.io/ent/schema/field"
    "entgo.io/ent/schema/mixin"
    "github.com/google/uuid"
)

type BaseMixin struct{ mixin.Schema }

func (BaseMixin) Fields() []ent.Field {
    return []ent.Field{
        field.UUID("id", uuid.UUID{}).Default(uuid.New),
        field.Time("created_at").Default(time.Now).Immutable(),
        field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
    }
}
```

Embed in any schema:

```go
func (User) Mixin() []ent.Mixin { return []ent.Mixin{ mixin.BaseMixin{} } }
```

Removes ~12 lines per schema and keeps timestamp semantics uniform.

#### Hooks — write-side middleware

[Hooks](https://entgo.io/docs/hooks/) wrap every Create / Update / Delete mutation. We use them for three things:

**1. Audit logging on sensitive writes** (`CreditLedger`, `OAuthConnection`, `MCPConnection`):

```go
// ent/schema/credit_ledger.go
func (CreditLedger) Hooks() []ent.Hook {
    return []ent.Hook{
        hook.On(
            func(next ent.Mutator) ent.Mutator {
                return ent.MutateFunc(func(ctx context.Context, m ent.Mutation) (ent.Value, error) {
                    delta, _ := m.Field("delta")
                    reason, _ := m.Field("reason")
                    reqID, _ := m.Field("request_id")
                    zap.L().Info("credit_ledger.write",
                        zap.Any("delta", delta),
                        zap.Any("reason", reason),
                        zap.Any("request_id", reqID))
                    return next.Mutate(ctx, m)
                })
            },
            ent.OpCreate,
        ),
    }
}
```

**2. Append-only enforcement** — `CreditLedger` should never be updated or deleted; enforce at the ORM layer in addition to the unique-index idempotency:

```go
return []ent.Hook{
    hook.Reject(ent.OpUpdate | ent.OpUpdateOne | ent.OpDelete | ent.OpDeleteOne),
}
```

**3. Encryption on the way in / decryption on the way out** for `OAuthConnection.refresh_token_encrypted` and `MCPConnection.refresh_token_encrypted` — hook reads the plaintext from `m.Field("refresh_token")` and stores the pgcrypto-sealed bytes.

#### Privacy — read-side security boundary

[Privacy policies](https://entgo.io/docs/privacy/) enforce row-level access at the ORM layer. **This is the most important ent feature we use** — it means internal code that calls the ent client can't accidentally leak data across users, because the privacy rules filter every query automatically.

Pattern: every per-user table gets a privacy policy that scopes queries to the user in the request context:

```go
// internal/auth/ctx.go
type userKey struct{}
func WithUser(ctx context.Context, u *ent.User) context.Context {
    return context.WithValue(ctx, userKey{}, u)
}
func UserFromCtx(ctx context.Context) (*ent.User, bool) {
    u, ok := ctx.Value(userKey{}).(*ent.User)
    return u, ok
}
```

The `auth.RequireOryJWT` middleware (mounted globally except on `/v1/config` and `/oauth-hooks/*`) puts the resolved `*ent.User` into the context. Then on each per-user schema:

```go
// ent/schema/credit_ledger.go
import "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/privacypolicy"

func (CreditLedger) Policy() ent.Policy {
    return privacy.Policy{
        Query: privacy.QueryPolicy{
            privacypolicy.ScopeToCurrentUser(),
        },
        Mutation: privacy.MutationPolicy{
            privacypolicy.RequireInternal(),     // only quota.Reserve/Settle/Refund can write
            privacy.AlwaysAllowRule(),
        },
    }
}
```

The helpers:

```go
// internal/privacypolicy/rules.go
func ScopeToCurrentUser() privacy.QueryRule {
    return privacy.CreditLedgerQueryRuleFunc(func(ctx context.Context, q *ent.CreditLedgerQuery) error {
        u, ok := auth.UserFromCtx(ctx)
        if !ok { return privacy.Deny }
        q.Where(creditledger.HasUserWith(user.IDEQ(u.ID)))
        return privacy.Allow
    })
}

func RequireInternal() privacy.MutationRule {
    return privacy.CreditLedgerMutationRuleFunc(func(ctx context.Context, m *ent.CreditLedgerMutation) error {
        if !auth.IsInternalCaller(ctx) {
            return privacy.Deny
        }
        return privacy.Allow
    })
}
```

Apply the same pattern to `MCPConnection`, `OAuthConnection`, `LLMUsage`, `Subscription`. Untrusted code can `.Query()` freely without leaking data.

#### Interceptors — read-side middleware

[Interceptors](https://entgo.io/docs/interceptors/) (introduced in ent v0.12) wrap queries the way hooks wrap mutations. Use cases for us:

- **Soft-delete filter** — if we add soft-delete later, an interceptor auto-applies `WHERE deleted_at IS NULL`. Not needed in v1 since we don't soft-delete anything yet.
- **Query metrics** — emit a span attribute with `entity_type` + `count` for OTel.

```go
// internal/db/interceptors.go
func WithQueryMetrics() ent.Interceptor {
    return intercept.Func(func(ctx context.Context, q intercept.Query) (intercept.Value, error) {
        start := time.Now()
        v, err := q.Next(ctx)
        if span := trace.SpanFromContext(ctx); span != nil {
            span.SetAttributes(
                attribute.String("ent.type", q.Type()),
                attribute.Int64("ent.duration_ms", time.Since(start).Milliseconds()),
            )
        }
        return v, err
    })
}
```

Register globally on the client:

```go
client.Intercept(WithQueryMetrics())
```

#### Custom field types & validators

ent supports [GoType](https://entgo.io/docs/schema-fields/#go-type) for richer field types (e.g., wrapping `[]byte` as a `EncryptedBytes` newtype that hides the underlying bytes from logs by implementing `MarshalJSON` to return `"[redacted]"`). Worth doing for `refresh_token_encrypted` and `payload_encrypted` so we don't accidentally log them.

#### Extensions we're enabling

All of the following are wired up at Milestone 0. Each annotation goes onto the relevant ent schema, each `go generate` step lives in `ent/generate.go`, each runtime artifact gets mounted in `cmd/server/main.go`. The end result is a richer ent layer with code-generated REST, gRPC, GraphQL, OpenAPI, history, cache, and programmatic schema tooling — at the cost of a larger codegen toolchain.

##### [`entoas`](https://entgo.io/docs/openapi/) — OpenAPI 3 spec generation

Public docs: [entgo.io/docs/openapi](https://entgo.io/docs/openapi/) · [github.com/ogen-go/ogen](https://github.com/ogen-go/ogen)

Generates an OpenAPI 3 document from ent schemas for the entity-shaped parts of the API. We hand-curate the streaming and proxy endpoints (LLM, voice, Composio, OAuth callbacks) and merge.

```go
// ent/generate.go
//go:generate go run -mod=mod ariga.io/ogent/cmd/ogent --target ../api ./schema
```

Per-schema annotations (which fields are exposed, which are read-only, etc.):

```go
func (User) Annotations() []schema.Annotation {
    return []schema.Annotation{
        entoas.CreatePolicy(entoas.Expose),
        entoas.UpdatePolicy(entoas.Expose),
    }
}
```

Output: `api/openapi.yaml` — committed to the repo, consumed by SDK generators and the docs site.

##### [`entrest`](https://github.com/lrstanley/entrest) — REST handler generation

Public docs: [github.com/lrstanley/entrest](https://github.com/lrstanley/entrest) (community extension; alternative: [`ogent`](https://github.com/ariga/ogent) handlers from `entoas`)

Used **selectively** for CRUD endpoints where the entity surface matches the API surface exactly. Concrete candidates:

- `GET/POST/DELETE /v1/admin/users/...` — admin CRUD (gated behind an admin scope)
- Internal `/v1/internal/connections/...` lookups
- Future `Scope` / `ConnectorRegistry` if we make those table-driven

Hand-written handlers stay where business logic is non-trivial (LLM, voice, OAuth, quota gates). The two coexist — `entrest`-generated handlers mount under their routes, hand-written handlers under theirs.

```go
// ent/generate.go
//go:generate go run -mod=mod github.com/lrstanley/entrest/cmd/entrest --target ../internal/restgen ./schema
```

##### [`entproto`](https://entgo.io/docs/grpc-intro/) — Protocol Buffers + gRPC service generation

Public docs: [entgo.io/docs/grpc-intro](https://entgo.io/docs/grpc-intro/) · [entgo.io/docs/grpc-setting-up](https://entgo.io/docs/grpc-setting-up/)

Generates `.proto` files from ent schemas + Go gRPC server stubs. Runtime gRPC server on port 8081 (HTTP stays on 8080). Use cases:

- Internal RPC between `rowboat-api` and `apps/oauth-consent` (admin operations on Hydra clients, fetch user state for consent rendering)
- Server-to-server entitlement checks from rowboat-api → Canvas/Corinthian/Billflow (lower-latency alternative to the HTTP `/v1/internal/entitlements`)
- Future SDK targets (the same `.proto` file generates Python, TS, Rust clients)

Per-schema annotation:

```go
func (User) Annotations() []schema.Annotation {
    return []schema.Annotation{
        entproto.Message(),
        entproto.Service(entproto.Methods(entproto.MethodGet | entproto.MethodList)),
    }
}

func (User) Fields() []ent.Field {
    return []ent.Field{
        field.UUID("id", uuid.UUID{}).Default(uuid.New).
            Annotations(entproto.Field(1)),
        field.String("email").Unique().
            Annotations(entproto.Field(2)),
        // ...
    }
}
```

Codegen wiring (requires `buf` + `protoc-gen-go` + `protoc-gen-go-grpc` on the build runner):

```go
// ent/generate.go
//go:generate go run -mod=mod entgo.io/contrib/entproto/cmd/entproto -path ./schema
//go:generate buf generate
```

Server mount (`cmd/server/main.go`):

```go
grpcSrv := grpc.NewServer(...)
proto.RegisterUserServiceServer(grpcSrv, rpc.NewUserService(client))
go grpcSrv.Serve(grpcLis)
```

##### [`entgql`](https://entgo.io/docs/tutorial-todo-gql/) — Relay-compliant GraphQL

Public docs: [entgo.io/docs/tutorial-todo-gql](https://entgo.io/docs/tutorial-todo-gql/) · [entgo.io/docs/tutorial-todo-gql-paginate](https://entgo.io/docs/tutorial-todo-gql-paginate/)

Generates GraphQL schema + Relay-style resolvers (connections, pagination, filters, ordering). Mount at `/graphql` for admin / internal dashboards and the eventual desktop "settings → connected accounts → history" surface.

Per-schema annotations:

```go
func (MCPConnection) Annotations() []schema.Annotation {
    return []schema.Annotation{
        entgql.QueryField(),
        entgql.RelayConnection(),
        entgql.OrderField("CONNECTED_AT"),
    }
}
```

Codegen wiring:

```go
//go:generate go run -mod=mod entgo.io/contrib/entgql/cmd/entviz ./schema
//go:generate go run -mod=mod github.com/99designs/gqlgen generate
```

Server mount uses `gqlgen` + the generated `ent.Client`:

```go
gqlSrv := handler.NewDefaultServer(gqlgen.NewSchema(client))
mux.Handle("/graphql", gqlSrv)
```

##### [`enthistory`](https://github.com/flume/enthistory) — automatic history tables

Public docs: [github.com/flume/enthistory](https://github.com/flume/enthistory)

Generates a `*_history` table for every annotated schema. Every Create/Update/Delete writes a history row including the actor (pulled from request context) and the snapshot.

Apply to **everything except `CreditLedger`** (already append-only) and `OAuthPending` (TTL'd ephemeral; history would be noise):

```go
func (Subscription) Annotations() []schema.Annotation {
    return []schema.Annotation{ enthistory.Annotations{} }
}
```

Auto-creates `subscription_history`, `oauth_connection_history`, `mcp_connection_history`, `llm_usage_history`, `user_history`. Critical for incident investigation (who changed a user's plan, when did a refresh token rotate, who connected/disconnected a product).

Codegen wiring:

```go
//go:generate go run -mod=mod github.com/flume/enthistory/cmd/enthistory ./schema
```

##### [`entcache`](https://github.com/ariga/entcache) — query-level caching

Public docs: [github.com/ariga/entcache](https://github.com/ariga/entcache)

Wraps the ent SQL driver with a transparent cache. We point it at the existing Redis (the same instance rate-limit buckets use) and tune TTLs per query.

```go
// internal/db/cached.go
import "ariga.io/entcache"

drv := entcache.NewDriver(
    sqlDrv,
    entcache.TTL(30*time.Second),                          // default
    entcache.Levels(
        entcache.NewLRU(1024),                             // in-process L1
        entcache.NewRedis(redisClient, "rowboat:ent:"),    // Redis L2
    ),
)
client := ent.NewClient(ent.Driver(drv))
```

Per-query overrides:

```go
// Cache /v1/me's user+subscription join for 5 minutes
ctx = entcache.WithTTL(ctx, 5*time.Minute)
user, _ := client.User.Query().WithSubscription().Only(ctx)
```

Skip on writes (entcache auto-invalidates) and on per-request contexts where staleness would matter (credit ledger reads inside the quota gate).

##### [`schemast`](https://entgo.io/docs/schemast/) — programmatic schema manipulation

Public docs: [entgo.io/docs/schemast](https://entgo.io/docs/schemast/)

Use to materialize ent schemas from external sources. Concrete use case: the **scope catalog** lives in `CONNECTOR_SUITE.md §5` (plus a JSON sibling). Right now it's a static map; with `schemast` we can generate a `Scope` ent schema from the catalog JSON so scope changes are a config-driven workflow rather than a schema edit.

```bash
# scripts/regenerate-scopes.go (Go program, invoked via make)
go run ./scripts/regenerate-scopes
```

The script reads `docs/scopes.json` and uses `schemast.Mutate` to upsert a `Scope` schema with the right fields. Runs only when the catalog changes.

##### Custom code-gen [templates](https://entgo.io/docs/templates/)

Public docs: [entgo.io/docs/templates](https://entgo.io/docs/templates/)

Extend the default codegen with rowboat-specific methods. Initial template targets:

- **Privacy injection** — auto-add `policy.go` boilerplate so every per-user schema gets `ScopeToCurrentUser()` without us copy-pasting.
- **Transactional helpers** — generate `WithTx` wrappers per entity that bind the ent transaction to the request context.
- **Audit hooks** — generate the audit-log hook for any schema annotated with `audit.AuditAll()`.

```go
// ent/generate.go
//go:generate go run -mod=mod entgo.io/ent/cmd/ent generate \
    --template ./templates/audit.tmpl \
    --template ./templates/privacy.tmpl \
    --template ./templates/withtx.tmpl \
    ./schema
```

#### Codegen toolchain summary

Add to `apps/rowboat-api/Makefile`:

```make
.PHONY: generate
generate: ent-generate proto-generate gql-generate openapi-generate

ent-generate:
	go generate ./ent/...

proto-generate:
	buf generate

gql-generate:
	go run github.com/99designs/gqlgen generate

openapi-generate:
	@echo "Merging hand-curated + entoas-generated OpenAPI"
	# Merge api/openapi.handcrafted.yaml + api/openapi.entoas.yaml → api/openapi.yaml
	go run ./scripts/merge-openapi
```

`make generate` runs after every schema change. CI fails if generated files drift from source.

#### Honest cost of enabling everything

| Concern | Impact |
|---------|--------|
| Build-time | +30–60s for codegen across all extensions; cached after first run |
| Runtime surface | HTTP (8080) + gRPC (8081) + Metrics (9090) ports; GraphQL handler under HTTP |
| Database surface | `*_history` tables roughly double the row count over time — partition / archive old history after 1 year |
| New deps in `go.mod` | `entgo.io/contrib/entproto`, `entgo.io/contrib/entgql`, `entgo.io/contrib/entoas`, `ariga.io/entcache`, `ariga.io/ogent`, `github.com/lrstanley/entrest`, `github.com/flume/enthistory`, `github.com/99designs/gqlgen`, `google.golang.org/grpc`, plus protoc plugins |
| Build tooling on CI | `buf`, `protoc-gen-go`, `protoc-gen-go-grpc`, `gqlgen` binary |
| Onboarding | ~half a day of "what's all this code-gen for" for a new engineer |

If we ever roll back an extension (say, drop GraphQL because nobody uses it), it's a matter of deleting the annotation, removing the `go generate` line, and dropping the route mount. The generated files disappear.

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

---

## Endpoint specification

The detailed shape of every endpoint above. Derived from grepping every `API_URL` call site in `apps/x/packages/core/src/`. If the desktop adds a new call, this section needs an update.

### Scope and non-goals

**In scope:** every endpoint the desktop calls on `API_URL` today, plus the connector-suite endpoints added by this plan.

**Not in scope:**
- The legacy Rowboat web platform (`apps/rowboat`) — different product, different API surface.
- Sign-in / user identity itself — handled by WorkOS. This backend just *verifies* Ory-issued JWTs derived from WorkOS sessions.
- PostHog — desktop sends events directly to PostHog Cloud.
- ElevenLabs / Deepgram / Exa / Composio direct mode — desktop falls back to direct API calls with user-supplied keys when not signed in.

### Cross-cutting concerns

#### Authentication

Every endpoint *except* `GET /v1/config` and `/oauth-hooks/*` requires an Ory-issued bearer token in `Authorization: Bearer <jwt>`. The desktop client obtains it via the OAuth 2.0 + PKCE flow against Hydra (see [CONNECTOR_SUITE.md §7](./CONNECTOR_SUITE.md#7-the-protocol--end-to-end)).

Verification: validate signature against Hydra's JWKS, check `iss`, `aud == "rowboat-api"`, `exp`, `nbf`. Reject invalid/expired with `401`. Trust the `ext.workos_user_id` claim; mirror it into the local `users` table on first call.

`/oauth-hooks/*` endpoints use shared-secret HMAC (`X-Hook-Signature`) instead — they're called by Ory, not by users.

#### Telemetry headers

LLM gateway calls carry these headers (set by `apps/x/packages/core/src/models/gateway.ts:11-13`):

| Header | Meaning |
|--------|---------|
| `x-rowboat-use-case` | Coarse-grained product surface (`chat`, `live-note`, `agent`, etc.) |
| `x-rowboat-sub-use-case` | Fine-grained (`note-creation`, `inbox-summary`, etc.) |
| `x-rowboat-agent-name` | Specific agent slug when an agent-style use-case is active |

Persist on usage records for product analytics and per-feature cost allocation.

#### Billing & quotas

`/v1/me` returns sanctioned + available credits. The desktop renders these and gates features client-side, but the backend MUST enforce server-side:

- Decrement available credits on every `/v1/llm/*`, `/v1/voice/*`, and `/v1/search/exa` call (see [Quota gate, in detail](#quota-gate-in-detail)).
- Pricing: per-1k-input-token / per-1k-output-token rates per model; flat charge per voice character; flat charge per Exa query. Source of truth is a config-driven `pricing` table seeded at boot.
- When `availableCredits <= 0`: return `402 Payment Required` with `{ "error": "insufficient_credits", "code": "insufficient_credits" }`.

#### Error envelope

```json
{ "error": "human_readable_message", "code": "machine_readable_slug" }
```

`POST /v1/google-oauth/refresh` adds an additional `reconnectRequired: boolean` field (consumed by `apps/x/packages/core/src/auth/google-backend-oauth.ts:100-103`).

#### Rate limits

| Route group | Limit |
|-------------|-------|
| `/v1/llm/*` | 60 req/min/user |
| `/v1/voice/*` | 30 req/min/user |
| `/v1/search/exa` | 60 req/min/user |
| `/v1/composio/*` | 120 req/min/user |
| `/v1/connections/*` | 30 req/min/user |
| Everything else | 600 req/min/user (sanity bucket) |

Return `429 Too Many Requests` with `Retry-After: <seconds>`. Implemented as a Redis token bucket keyed by `(user_id, route_group)`.

---

### `GET /v1/config`

**Auth:** none (public).

**Response 200:**
```json
{
  "appUrl": "https://app.solomon-ai.co",
  "oidcIssuerUrl": "https://oauth.solomon-ai.co",
  "websocketApiUrl": "wss://realtime.solomon-ai.co"
}
```

- `appUrl` is REQUIRED — the desktop bombs out without it (`apps/x/packages/core/src/config/remote-config.ts:28-30`).
- `oidcIssuerUrl` is the Hydra issuer; the desktop uses this for OAuth discovery.
- `websocketApiUrl` may be empty string.

**Caller:** `remote-config.ts:23`, `config/rowboat.ts:11`.

**Caching:** Desktop caches in-process; set `Cache-Control: public, max-age=300`.

> Note on the field name: the desktop's current code reads this as `supabaseUrl` (`apps/x/packages/core/src/auth/providers.ts:107-111`). Milestone 1 patches the desktop to read `oidcIssuerUrl` instead.

---

### `GET /v1/me`

**Auth:** Ory bearer (audience `rowboat-api`).

**Response 200:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  },
  "billing": {
    "plan": "free" | "pro" | "team" | null,
    "status": "active" | "trialing" | "past_due" | "canceled" | null,
    "trialExpiresAt": "2026-06-01T00:00:00.000Z" | null,
    "usage": {
      "sanctionedCredits": 10000,
      "availableCredits": 8421
    }
  }
}
```

**Caller:** `apps/x/packages/core/src/billing/billing.ts:7`. Response shape mirrors lines 13-27 of that file.

**Notes:**
- `plan` values must match `BillingPlan` in `apps/x/packages/shared/src/billing.ts`.
- Credits are integer "units" — dollar-to-unit conversion is a backend-side decision (see [Open questions](#open-questions)).

---

### `POST /v1/google-oauth/claim`

Used in the Google OAuth handoff: the webapp completes the OAuth dance, *parks* tokens keyed by a `state` ticket, and the desktop redeems that ticket here.

**Auth:** Ory bearer.

**Request:**
```json
{ "session": "opaque-state-string-from-deeplink" }
```

**Response 200:**
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": 1735689600,
  "scope": "openid email https://www.googleapis.com/auth/gmail.readonly",
  "token_type": "Bearer"
}
```

`expires_at` is seconds-since-epoch. `scope` is space-delimited. `refresh_token` may be absent on rare Google responses (caller handles that).

**Error 4xx:**
```json
{ "error": "ticket_expired", "code": "ticket_expired" }
```

**Caller:** `auth/google-backend-oauth.ts:82`.

**Storage:** Parked tickets live in `OAuthPending` (ent) with a 10-min TTL. Reading consumes the row. The webapp inserts after its callback succeeds.

---

### `POST /v1/google-oauth/refresh`

The refresh step holds the Google OAuth client secret, so it can't run on the desktop.

**Auth:** Ory bearer.

**Request:**
```json
{ "refreshToken": "1//0g..." }
```

**Response 200:** Same shape as `/claim`. Google often omits `refresh_token` and `scope` on refresh; caller preserves the previous values.

**Response 409:** Google `invalid_grant` (user revoked, refresh token expired).
```json
{
  "error": "Google reports invalid_grant; user must reconnect.",
  "code": "reconnect_required",
  "reconnectRequired": true
}
```

The `reconnectRequired: true` field is required — the desktop branches on it (`google-backend-oauth.ts:101-103`) and throws a typed `ReconnectRequiredError`.

**Caller:** `auth/google-backend-oauth.ts:99`.

---

### `POST /v1/llm/*` — OpenRouter-compatible LLM gateway

**The largest surface and highest-cost path.** The desktop wraps it with `createOpenRouter()` from `@openrouter/ai-sdk-provider` (`models/gateway.ts:19-23`), which sends OpenRouter-style requests (OpenAI-compatible).

**Auth:** Ory bearer.

**Required telemetry headers:** see [Telemetry headers](#telemetry-headers).

**Endpoints to implement:**
- `POST /v1/llm/chat/completions` (primary)
- `POST /v1/llm/completions`
- `POST /v1/llm/embeddings` (if used)

**Request body** mirrors OpenAI Chat Completions:
```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 4000,
  "tools": [ ... ],
  "tool_choice": "auto"
}
```

**Streaming:** When `stream: true`, return `text/event-stream` with `data: { ... }\n\n` chunks terminated by `data: [DONE]\n\n`. Match OpenAI's delta envelope.

**Provider routing:** Internally, key the `model` string to an upstream:
- `anthropic/*` → Anthropic API
- `openai/*` → OpenAI API
- `google/*` → Vertex / Gemini API
- `openrouter/*` → OpenRouter passthrough
- (extend as needed)

**Quota gate:** Estimate input tokens + expected output; if available credits would go negative, return `402` BEFORE proxying upstream. After upstream response, decrement actual tokens used. See [Quota gate, in detail](#quota-gate-in-detail).

**Cost recording:** Insert an `LLMUsage` row per call:
```
(user_id, ts, model, use_case, sub_use_case, agent_name,
 input_tokens, output_tokens, cost_units, request_id)
```

---

### `GET /v1/llm/models`

**Auth:** Ory bearer.

**Response 200:** OpenAI-compatible list envelope:
```json
{
  "data": [
    { "id": "anthropic/claude-sonnet-4-5" },
    { "id": "openai/gpt-4.1" },
    { "id": "google/gemini-2.5-pro" }
  ]
}
```

**Caller:** `models/gateway.ts:38-52`. Desktop only reads `id` from each row, so additional fields are tolerated but not required.

---

### `POST /v1/voice/text-to-speech/{voiceId}`

ElevenLabs proxy. `voiceId` is the ElevenLabs voice id; desktop defaults to `UgBBYS2sOqTuMpoF3BR0` (`voice.ts:43`).

**Auth:** Ory bearer.

**Request:**
```json
{
  "text": "Hello, world.",
  "model_id": "eleven_flash_v2_5",
  "voice_settings": { "stability": 0.5, "similarity_boost": 0.75 }
}
```

**Response 200:**
- `Content-Type: audio/mpeg`
- Raw audio bytes (desktop base64-encodes for transport across IPC; we just emit bytes).

**Quota gate:** Decrement credits by `ceil(len(text) * VOICE_RATE)`.

**Caller:** `voice/voice.ts:45`.

**Implementation:** Pass-through to ElevenLabs `/v1/text-to-speech/{voiceId}` with our server-held `xi-api-key`.

---

### `POST /v1/search/exa`

Exa Search proxy.

**Auth:** Ory bearer.

**Request:** Pass-through to Exa's `POST /search`. Shape (subset):
```json
{
  "query": "...",
  "num_results": 10,
  "use_autoprompt": true,
  "type": "auto",
  "contents": { "text": true }
}
```

**Response:** Pass-through Exa response.

**Quota gate:** Flat charge per call.

**Caller:** `application/lib/builtin-tools.ts:1377`.

**Implementation:** Forward to `https://api.exa.ai/search` with our server-held `x-api-key`.

---

### `* /v1/composio/*` — Composio passthrough proxy

The most complex non-LLM surface. Maps to `https://backend.composio.dev/api/v3/*`.

**Auth:** Ory bearer; swap to our server-held `x-api-key` upstream.

**Routes consumed by the desktop** (from `composio/client.ts`):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/composio/toolkits` | List toolkits (`sort_by`, optional `cursor`) |
| GET | `/v1/composio/toolkits/{slug}` | Toolkit detail |
| GET | `/v1/composio/auth_configs` | List auth configs (`toolkit_slug`, `cursor`, `is_composio_managed`) |
| POST | `/v1/composio/auth_configs` | Create auth config |
| POST | `/v1/composio/connected_accounts` | Create connected account |
| GET | `/v1/composio/connected_accounts/{id}` | Get connected account |
| DELETE | `/v1/composio/connected_accounts/{id}` | Delete connected account |
| GET | `/v1/composio/tools` | Search tools (`query`, `limit`, optional `toolkit_slug`) |
| POST | `/v1/composio/tools/execute/{actionSlug}` | Execute a tool action |

**Request/response shapes:** match Composio v3 exactly. Don't translate.

**Scope hardening:** enforce that `connected_accounts` and `auth_configs` are scoped to the authenticated user — Composio's tenancy maps to a Composio account we hold per-user (see `composio_links` in [Storage model](#storage-model-relationship-to-ent-schemas)).

---

### Connector endpoints (see CONNECTOR_SUITE.md for full protocol)

These are the rowboat-api endpoints introduced by the connector suite. Their detailed semantics live in [CONNECTOR_SUITE.md §7](./CONNECTOR_SUITE.md#7-the-protocol--end-to-end); the table here is the canonical reference for routes and ent schema interactions.

- `GET /v1/connectors` — lists products + scope catalog + per-user `connected` status from `MCPConnection`.
- `POST /v1/connections/{name}/start` — generates state + PKCE, persists in `OAuthPending`, returns Ory `/oauth2/auth` URL.
- `GET /v1/connections/{name}/callback` — Ory redirect target; exchanges code for tokens at Ory `/oauth2/token`, stores refresh in `MCPConnection.refresh_token_encrypted`, deep-links the desktop via `rowboat://connection-complete?...`.
- `POST /v1/connections/{name}/mcp-token` — returns cached access token or refreshes via Ory.
- `DELETE /v1/connections/{name}` — calls Ory `/oauth2/revoke`, deletes the `MCPConnection`.
- `POST /oauth-hooks/pre-consent` — webhook from Ory; calls each product's `/v1/internal/entitlements` to check subscription, returns `{ allow, upsell? }`.
- `POST /v1/internal/connections/invalidate` — server-to-server; products call when a user must be force-disconnected.

---

### Out-of-band integrations (not this API)

These integrations are direct from the desktop and don't go through rowboat-api:

| System | How desktop reaches it | Notes |
|--------|------------------------|-------|
| **WorkOS AuthKit** | Direct OAuth code-flow via Hydra | User identity. WorkOS issues the session that Hydra delegates to. |
| **Ory Hydra** | Direct PKCE flow for sign-in + per-product connections | Token issuer. rowboat-api verifies, never proxies. |
| **PostHog** | Direct via `posthog-node` | Analytics + exception capture. Not proxied. |
| **Stripe** | Webapp (not desktop), via Polar fork | Billing source. Stripe → Polar → our DB. Desktop reads results via `/v1/me`. |
| **Google OAuth** | Webapp callback parks tokens; desktop redeems via [`POST /v1/google-oauth/claim`](#post-v1google-oauthclaim) / [`refresh`](#post-v1google-oauthrefresh) | Web side holds OAuth client secret. |
| **ElevenLabs / Deepgram / Exa / Composio (signed-out)** | Desktop calls vendors directly with user-supplied keys from `~/.rowboat/config/*.json` | Fallback path. rowboat-api only fronts these when user is *signed in*. |
| **Canvas / Corinthian / Billflow MCPs** | Direct HTTP transport with Ory-issued bearer | rowboat-api brokers OAuth; never proxies MCP calls. |

---

### Storage model (relationship to ent schemas)

The ent schemas defined above translate to these logical tables. Reading either is equivalent — ent is the source of truth, this is a quick-reference:

```
users               ent.User              (id, email, workos_user_id, workos_org_id, created_at)
subscriptions       ent.Subscription      (plan, status, trial_expires_at, sanctioned_credits, stripe_*)
credit_ledger       ent.CreditLedger      (id, user_id, delta, reason, request_id, ts) — append-only
llm_usage           ent.LLMUsage          (id, user_id, model, use_case, sub_use_case, agent_name,
                                           input_tokens, output_tokens, cost_units, request_id, ts)
oauth_pending       ent.OAuthPending      (state, provider, payload_encrypted, expires_at) — TTL'd
oauth_connections   ent.OAuthConnection   (user_id, provider, refresh_token_encrypted, scopes, updated_at)
mcp_connections     ent.MCPConnection     (user_id, connector, audience, scopes,
                                           refresh_token_encrypted, connected_at, last_used_at, expires_at)
composio_links      —                     map our user → Composio entity (TBD: separate table or
                                          field on User; depends on [Composio tenancy](#open-questions))
api_keys_vault      —                     vendor keys held in Infisical, not in Postgres
rate_limits         —                     Redis (token bucket), not Postgres
```

`available_credits` is computed as `subscription.sanctioned_credits + SUM(credit_ledger.delta)` for the user. Persist a cached value in Redis if the SUM ever becomes a hot path.

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
| 0 | **Scaffold** | `apps/rowboat-api/` created in this repo via the podinfo cherry-pick. chi server boots on 8080. **gRPC server boots on 8081** (empty service registry, ready for entproto-generated services). **Metrics server on 9090**. OTel + zap wired. Health checks. **Helm values at `charts/rowboat-api/` deploy to the US-East k3s cluster** via the existing IaC tooling. **Full ent codegen toolchain wired** (`make generate` runs ent + entproto + entgql + entoas + enthistory + custom templates; `buf`, `protoc-gen-go`, `protoc-gen-go-grpc`, `gqlgen` installed on CI). ent generates empty client with all extensions active but no schemas yet. **Atlas migrations** working against managed Postgres. **WorkOS project created, one OIDC client registered in the AuthKit dashboard, `client_id` recorded as a build-time secret. JWKS endpoint reachable.** |
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
2. **Pricing model.** Per-1k-input-token / per-1k-output-token rates per model; voice character rate; Exa per-query rate; trial-vs-paid credit caps. Need product input before Milestone 4.
3. **Multi-tenancy.** Are Rowboat-desktop users tied to a Canvas/Corinthian `team_id` (B2B share-a-Robo case), or strictly individual? Current plan: individual. Affects `/v1/me` response shape and Composio scoping.
4. **Free tier behavior.** Does an unauthenticated desktop see *any* of our backend, or only `/v1/config`? Current desktop falls back to direct vendor calls when not signed in — preserve that, but decide whether anonymous LLM access is offered.
5. **Model catalog source.** Hardcode the supported model list, mirror models.dev, or admin tool to manage it? Affects `/v1/llm/models` source-of-truth and how often we add new providers.
6. **Composio tenancy.** One shared Composio account with our pool key, or one Composio account per user? Affects `composio_links` and connected-account isolation.
7. **Wispr Flow API access.** Does it have a public/partner API at all? If not, defer Milestone 11. (Grep confirmed: zero internal references anywhere in the org.)
8. **Cross-product auth for Canvas + Corinthian MCPs.** Each product embeds `packages/oauth-resource-server-ts` and verifies tokens against our Hydra JWKS. See [CONNECTOR_SUITE.md §9](./CONNECTOR_SUITE.md#9-the-oauth-resource-server-libraries). Confirm Canvas + Corinthian product owners are aligned on swapping from current `X-API-Key`/`Authorization: Bearer (Supabase)` to Hydra-issued JWTs.
9. **Streaming infra at the edge.** k3s + NGINX ingress handles long-lived SSE for `/v1/llm/*` fine. If we ever front rowboat-api with a CDN, make sure the CDN passes through `text/event-stream` without buffering.
10. **Domain / DNS.** What hostnames will `rowboat-api`, `canvas-mcp`, `corinthian-mcp`, and the WorkOS-issued tokens belong to? Suggest:
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
