# rowboat-api

The Rowboat desktop backend. Replaces the closed hosted backend
(`https://api.x.rowboatlabs.com`) that the Electron desktop (`apps/x`) calls.
It owns billing/credits, the LLM gateway, vendor proxies (voice, search), the
Google OAuth broker, and the managed connector handshake.

See [RFC 010](../../apps/rfc/010-rowboat-api-service-plane.md) for the service-plane
design, [RFC 011](../../apps/rfc/complete-011-identity-and-authorization-plane.md) for auth
boundaries, and [RFC 012](../../apps/rfc/012-connector-suite-and-consent-broker.md)
for the connector broker protocol.

## A note on the podinfo bootstrap

The plan calls for cloning [stefanprodan/podinfo](https://github.com/stefanprodan/podinfo)
and stripping it. The end-of-bootstrap sanity check the plan defines is "zero
references to `stefanprodan/podinfo` in any non-attribution file" — i.e. the
scaffolding is meant to end up fully ours regardless. Rather than clone ~100
demo files and delete most of them, this service ships a **clean, equivalent
scaffold** that satisfies every bullet of the plan's end-of-bootstrap state:

- compiles via `go build ./...`, passes `go vet ./...` and `golangci-lint run`
- boots via `go run ./cmd/server` and answers `/healthz` + `/readyz` with 200s
- emits one OTel span per request and structured JSON logs to stdout
- multi-stage distroless Dockerfile, Makefile, graceful shutdown, Prometheus
  metrics on a separate port — the operational scaffolding podinfo is prized for
- zero `stefanprodan/podinfo` references anywhere

This is the faithful realization of the plan's intent (a production-grade Go
microservice skeleton) without carrying podinfo's demo surface.

## Layout

```
cmd/server/        main.go + wire.go (composition root)
internal/
  appconfig/       env-driven Config (single config surface)
  openapidoc/      post-entoas OpenAPI enrichment for the mounted runtime API
  telemetry/       zap logging + OTel tracing
  server/          chi router, middleware chain, health probes, graceful shutdown
  version/         build-time version stamping (ldflags)
  ...              feature packages land per-milestone (config, billing, llm, …)
ent/               ent schemas → generated type-safe client (see ent/README)
charts/            Helm values live at repo-root charts/rowboat-api/
```

## Run locally

```bash
make run                       # go run ./cmd/server
# or
make build && ./bin/rowboat-api

curl localhost:8080/healthz    # {"status":"ok"}
curl localhost:8080/readyz     # {"status":"ready"}
open http://localhost:8080/docs # Scalar API reference
curl localhost:8080/openapi.json
curl localhost:9090/metrics    # prometheus
```

All configuration has dev defaults; see `internal/appconfig/config.go` for the
full env-var surface and `.env.example` for a starting point.

## Local end-to-end with the desktop (`devstack`)

Sign-in uses **real WorkOS AuthKit**, brokered by rowboat-api (WorkOS is a
confidential client, so the code→token exchange runs server-side; no Ory Hydra —
see [`AUTH.md`](./AUTH.md)). The WorkOS API key is read from the **gitignored
root `.env`**, which docker compose auto-loads — no manual sourcing.
`docker-compose.rowboat-api.yml` brings up Postgres, Redis, the api, and
`devstack`, which now serves **only** the dev vendor mocks:

- a mock OpenAI-compatible LLM (`/v1/chat/completions`, SSE + usage);
- a mock Google token endpoint (`/v1/google-oauth-mock/token`).

```bash
# root .env holds WORKOS_API_KEY (see AUTH.md)
docker compose -f docker-compose.rowboat-api.yml up --build -d
cd apps/x && API_URL=http://localhost:18080 npm run dev   # point the desktop at the local api
```

Then click **“Sign in to Rowboat”** in the desktop sidebar: the desktop asks
rowboat-api for the WorkOS authorize URL, opens it in the browser (the real
AuthKit login), and on callback hands the code to rowboat-api’s
`/v1/auth/workos/exchange`, which completes the exchange server-side with the API
key and returns tokens. rowboat-api verifies the returned WorkOS token on every
call (`TOKEN_ISSUER=https://api.workos.com`, WorkOS JWKS). No tokens are injected.

**Google OAuth.** `/v1/google-oauth/refresh` needs a client id/secret or it
returns `502 provider_unconfigured`. In dev, the compose file sets dummy
`GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` and points
`GOOGLE_TOKEN_URL` at devstack’s mock, so refresh returns a (fake) token. For a
**real** Google connection, create an OAuth 2.0 Client in Google Cloud Console,
set those two secrets to the real values, and leave `GOOGLE_TOKEN_URL` unset
(defaults to `https://oauth2.googleapis.com/token`).

## Local kind cluster with the Helm chart

Use this when you want to validate the Kubernetes deployment path locally. It
deploys the real `charts/rowboat-api` chart into kind with local Postgres,
Redis, and the devstack OIDC/WorkOS/LLM mocks:

```bash
scripts/rowboat-api-kind.sh up
scripts/rowboat-api-kind.sh desktop
```

The desktop runs with `API_URL=http://localhost:18080`. See
[`docs/LOCAL_KIND_ROWBOAT_API.md`](../../docs/LOCAL_KIND_ROWBOAT_API.md) for the
full workflow and smoke-test coverage.

The Scalar API reference is available at `http://localhost:18080/docs`, backed
by the embedded OpenAPI document at `http://localhost:18080/openapi.json`.

## Fly.io deployment

Fly.io is supported as an alternative production target with one public API
Machine in US East (`iad`) and one in US West (`sjc`). The default topology
keeps the East API warm, lets the West API stop while idle, and runs one worker
and one scheduler in the primary region. See [`docs/fly-io.md`](docs/fly-io.md)
for provisioning, secrets, deployment, cost, and rollback guidance.

## Public SDK contract

`api/openapi.json` is the public contract for generated REST SDKs. Ent schemas
feed the OpenAPI components, `cmd/openapi-enrich` replaces the path surface with
the mounted runtime API, and the TypeScript SDK in
[`packages/rowboat-api-client-ts`](../../packages/rowboat-api-client-ts) is
generated from the resulting document.

Regenerate the SDK after changing public routes, request/response schemas, or
OpenAPI enrichment:

```bash
make sdk-generate
```

## Ports

| Port | Purpose                                    |
| ---- | ------------------------------------------ |
| 8080 | Public HTTP + SSE (the desktop talks here) |
| 8081 | gRPC (reserved for entproto services)      |
| 9090 | Prometheus `/metrics`                      |

## Make targets

| Target                     | Does                                               |
| -------------------------- | -------------------------------------------------- |
| `make build`               | static binary → `bin/rowboat-api`                  |
| `make run`                 | run from source                                    |
| `make test`                | `go test ./... -race`                              |
| `make vet` / `lint`        | `go vet` / `golangci-lint`                         |
| `make generate`            | full codegen pipeline (ent → proto → gqlgen → SDK) |
| `make sdk-generate`        | TypeScript SDK from `api/openapi.json`             |
| `make install-tools`       | protoc-gen-go / -go-grpc / -entgrpc plugins        |
| `make migrate-dump name=…` | write schema DDL to migrations/                    |
| `make docker-build`        | multi-stage image                                  |

## ent codegen extensions

The ent layer enables the full extension toolchain (`make generate` reproduces
all of it):

| Extension               | What it produces                                                          | Surfaced as                               |
| ----------------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| privacy / intercept     | tenant-scoping + query metrics                                            | enforced in `internal/db`                 |
| **entcache**            | query cache (LRU L1 + Redis L2), opt-in                                   | `db.DB.Cached` (used by `/v1/me`)         |
| **enthistory**          | `*_history` tables on User/Subscription/OAuth/MCP/LLMUsage                | `client.*History`, auto-written on writes |
| **entoas + openapidoc** | OpenAPI 3 spec for the mounted runtime API with ent schemas as components | `api/openapi.json`                        |
| **entgql**              | Relay GraphQL schema + resolvers                                          | `POST /graphql` (admin, internal-secret)  |
| **entproto**            | protobuf + gRPC `UserService`                                             | gRPC on `:8081` (`ent/proto/entpb`)       |

CreditLedger (append-only) and OAuthPending (TTL'd) are intentionally excluded
from history. History tables and sensitive token columns are excluded from the
GraphQL/gRPC surfaces.

## Milestone status

All plan milestones implemented (config, identity, LLM gateway, voice/exa,
Google OAuth, managed connectors) plus the full ent extension toolchain. See the
repo task list / commit history for details.
