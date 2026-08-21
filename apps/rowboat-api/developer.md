# Rowboat API implementation patterns

The Rowboat API is a production-oriented **modular monolith**: one repository
and shared database, split into vertical feature packages, with separate
server, worker, scheduler, migration, and projection processes. Its strongest
recurring themes are defense-in-depth authorization, schema-driven
persistence, explicit state machines, idempotent operations, and durable
asynchronous workflows.

## High-level architecture

```text
Desktop / providers / internal services
                  |
                  v
       chi router + middleware
                  |
       +----------+----------+
       |                     |
       v                     v
 HTTP handlers         Webhook ingestion
       |                     |
 Domain services        CloudEvent records
       |                     |
       +---- Ent ORM         v
       |               Temporal workflows
       |                     |
       v                     v
Postgres / SQLite      Activities + services
       |
       +---- outbox/events -> external systems
```

Separate executables include:

- `cmd/server`: REST, SSE, GraphQL, gRPC, health, and metrics.
- `cmd/worker`: Temporal activities and workflows.
- `cmd/scheduler`: scheduled task admission.
- `cmd/relationship-projector`: projection processing.
- `cmd/migrate`: schema operations.
- `cmd/devstack`: local provider mocks.

## Dominant implementation patterns

### 1. Manual dependency injection through a composition root

Dependencies are assembled explicitly in `cmd/server/wire.go`. There is no DI
framework. A typical flow is:

```go
service := feature.New(...)
service.SetPolicy(...)
handler := feature.NewHandler(service, log)
router.Post(..., handler.Method)
```

This makes construction visible and debuggable. Optional features are
represented by `nil`, disabled implementations, or conditional route mounting.

The trade-off is that `wire.go` is already large, and several components use
two-phase initialization through methods such as `SetPolicy`, `SetTemporal`,
and `SetOutboundPolicy`. This makes it possible to construct a partially
configured object.

### 2. Vertical feature packages

Most features own their complete implementation under `internal/<feature>`,
including packages such as:

- `internal/llm`
- `internal/connectors`
- `internal/cloudevents`
- `internal/backgroundtasks`
- `internal/agentworkflow`
- `internal/revenue`
- `internal/google`
- `internal/slack`

Packages generally contain some combination of:

- `handler.go`: HTTP translation.
- `service.go` or `broker.go`: business rules.
- Provider or client files.
- Metrics.
- Package-local tests.

This is closer to a vertical-slice architecture than a traditional global
controller/service/repository hierarchy.

### 3. Handler-centric simple features, service-centric complex features

Small packages often put most behavior directly in a `Handler`. More complex
domains introduce explicit services and interfaces. For example, revenue
separates HTTP concerns in `internal/revenue/handler.go` from lifecycle
invariants in `internal/revenue/service.go`.

The separation is pragmatic rather than mechanically enforced across every
package.

### 4. Schema-driven persistence with Ent

The data layer is built around handwritten Ent schemas and generated Ent code.
Schemas generate:

- Typed CRUD and query APIs.
- History tables.
- GraphQL schema and resolvers.
- Protobuf and gRPC services.
- OpenAPI components.
- Migration DDL.

The generation pipeline is documented in the `Makefile`.

Domain code usually talks directly to `*ent.Client`; there is generally no
repository abstraction. This reduces boilerplate but couples business services
closely to Ent and makes database-backed tests the natural testing style.

### 5. Context-based identity and tenant scoping

Authentication resolves a bearer token into both a user and an `Actor`, then
stores them in `context.Context`. Downstream services rely on that context.

Tenant protection is enforced in two independent layers:

- Read scoping through Ent interceptors in `internal/db/interceptors.go`.
- Write scoping through Ent mutation hooks in `internal/db/hooks.go`.

Handlers therefore do not need to remember a user predicate for every query.
Internal workflows can intentionally bypass scoping or attach an explicit
tenant user.

The downside is that a missing context value produces database-layer
authorization errors, which can make background-flow debugging less obvious.

### 6. Layered, route-specific authorization

Routes are deliberately divided into:

- Public configuration and documentation.
- Pre-authentication WorkOS broker routes.
- Signed provider webhooks.
- HMAC-protected hooks.
- Internal-secret APIs.
- Internal GraphQL and gRPC.
- JWT-authenticated user APIs.
- Step-up-protected sensitive actions.

This matrix is visible in `cmd/server/wire.go`. Authorization middleware
supports actor kind, scopes, permissions, entitlements, organization
membership, recent authentication, and MFA. Sensitive checks generally fail
closed.

### 7. Defense-in-depth middleware

The baseline server middleware covers:

- Trusted-proxy-aware client IP extraction.
- Request IDs.
- Panic recovery.
- Structured request logging.
- Security headers.
- Allowlisted CORS.
- No-cache headers.
- Request deadlines.
- Body-size limits.
- JSON content-type enforcement.

It lives primarily in `internal/server/middleware.go`. Streaming endpoints
receive explicit exceptions for request and write deadlines, so SSE and LLM
streaming are treated as first-class transport modes rather than ordinary
requests.

### 8. Explicit domain state machines

Complex behavior is implemented as guarded state transitions rather than
general CRUD. The revenue action lifecycle independently tracks:

- Queue state.
- Policy and preflight state.
- Approval state.
- Execution state.
- Immutable revision.
- Execution ownership.

Its errors correspond to named business invariants in
`internal/revenue/service.go`. Handlers translate these typed sentinel errors
into stable API problem codes in `internal/revenue/handler.go`.

### 9. Idempotency as an architectural rule

Idempotency appears throughout the application, particularly at distributed
boundaries:

- Cloud-event deduplication.
- Quota reservations.
- Background-task retries.
- Provider writes.
- Action execution.
- Outbox events.
- Identity decisions.
- Schedule leases.
- WorkOS refreshes.

Typical mechanisms include unique database constraints, request-derived UUIDs,
explicit idempotency keys, content hashes, compare-and-update transitions,
immutable revision snapshots, and provider-specific markers.

Cloud-event ingestion, for example, converts a uniqueness conflict into an
idempotent replay result in `internal/cloudevents/ingest.go`. This is one of the
codebase's clearest and most consistent implementation conventions.

### 10. Transactions around business invariants

Transactions are used when multiple records collectively represent one state
transition, including:

- Action plus revision snapshot.
- Quota reservation plus ledger entry.
- Policy decision plus action update.
- Commitment event plus materialized state.
- Identity decision plus lineage event.
- Outbox event plus domain mutation.

The code normally rolls back explicitly on intermediate errors and calls
`Unwrap()` after commit for Ent entities created inside a transaction.

### 11. Append-only records and materialized projections

Several data types are intentionally immutable:

- Credit ledger entries.
- Identity decisions.
- Lineage events.
- Action revisions.
- Policy decision snapshots.
- Outcomes.
- Trust events.
- Commitment events.

Current state is held in a mutable projection or parent record. This provides
an audit trail while keeping reads efficient. Append-only enforcement is placed
at the ORM hook level, not merely in handler logic.

### 12. Temporal workflows for durable orchestration

Long-running work is modeled using Temporal:

- Workflow code coordinates deterministic steps.
- Activities perform database, network, and LLM operations.
- Stable workflow IDs prevent duplicate starts.
- Activities tolerate retries.
- Signals implement cancel, approval, and context updates.

The boundary is defined by a small `Controller` interface in
`internal/backgroundtaskworkflow/workflow.go`. HTTP handlers and schedulers
depend on this interface rather than directly on the concrete Temporal client.

### 13. Interfaces at unstable or external seams

The code does not abstract everything. Interfaces are concentrated where
alternative implementations or testing are valuable:

- Action executors and reconcilers.
- LLM completers.
- Workflow starters.
- Schedule managers.
- Event routers.
- Secret and provider clients.
- Runtime tools.
- Entitlement checks.

Database access stays concrete Ent, while external effects are more frequently
abstracted. The convention is effectively to abstract volatility rather than
every dependency.

### 14. Centralized outbound resilience

External HTTP calls can use the shared transport in
`internal/outbound/outbound.go`, which implements:

- Concurrency limits.
- Connection pooling.
- Response-size bounds.
- Limited retries.
- Circuit breaking.
- Cancellation.
- Idempotency-aware replay rules.

Non-idempotent requests are not retried unless the provider is explicitly
configured to honor idempotency keys.

### 15. Graceful degradation, except at security boundaries

Development defaults favor easy startup:

- No database URL results in SQLite.
- No Redis results in in-memory rate limiting and L1 cache.
- A missing vendor key makes the feature report `provider_unconfigured`.
- Temporarily missing JWKS makes authenticated routes return 503.
- Optional dependencies can mark readiness as degraded.

Security-sensitive behavior generally fails closed:

- A missing entitlement checker denies access.
- Production secret-loading failure aborts startup.
- An unconfigured execution backend refuses execution.
- A missing non-development gRPC secret rejects calls.

### 16. Explicit API DTOs and RFC 9457 errors

Handlers do not normally serialize Ent entities directly when sensitive or
internal fields are involved. Revenue uses explicit DTOs to control exposure.

Errors use the shared RFC 9457 envelope in `internal/httpx/respond.go`, which
contains:

- A stable machine-readable code.
- Request ID.
- Trace ID.
- Server-calculated retryability.

### 17. Environment configuration as one large typed surface

Configuration is loaded once from environment variables and passed by value.
Defaults and production validation are centralized in
`internal/appconfig/config.go`.

This provides a single source of truth, but the file and `Config` struct now
cover many unrelated domains and have effectively become a configuration god
object.

### 18. Package-local tests with real persistence and fake providers

Common testing styles include:

- `httptest` handler tests.
- SQLite-backed Ent integration tests.
- Table-driven validation tests.
- Fake workflow controllers.
- Mock provider HTTP servers.
- Invariant and race-condition regression tests.
- Route-exposure and schema guard tests.

At the time of this audit, `go test ./...` passed across the repository. This
was the standard suite rather than the `-race` target used by `make test`.

## Architectural strengths

- Strong tenant isolation at the persistence boundary.
- Consistent attention to idempotency and ambiguous provider results.
- Durable event and workflow design.
- Explicit fail-closed security behavior.
- Good package-local test coverage.
- Careful outbound retry policy.
- Immutable audit and history modeling.
- Reproducible code-generation pipeline.
- Stable API error structure.

## Maintainability pressures

1. **Large concentration points.** `cmd/server/wire.go`,
   `internal/appconfig/config.go`, `internal/revenue/handler.go`,
   `internal/revenue/service.go`, and `internal/db/interceptors.go` are becoming
   difficult navigation and review boundaries.

2. **Two-phase component configuration.** Constructor-plus-setter wiring makes
   required dependencies less obvious than constructor arguments or dedicated
   option structures.

3. **Persistence coupling.** Direct Ent use is efficient, but large domain
   services are harder to test independently from the database.

4. **Manual authorization registration.** The route matrix is clear when
   reading `wire.go`, but a new route can miss the intended middleware unless
   route-exposure tests are updated.

5. **Dual migration story.** Local or first-deploy auto-migration and checked-in
   SQL migrations coexist. Production ownership of schema changes must remain
   disciplined so the two mechanisms do not drift.

6. **Generated contract enrichment.** OpenAPI is generated and then heavily
   enriched in Go. Route registration, enrichment, and SDK generation must
   always move together.

7. **Missing direct tests around the shared outbound transport.**
   `internal/outbound` contains critical retry, concurrency, and breaker
   behavior but currently has no package test files.

8. **Documentation drift.** The RFC 010 link in `README.md` points to
   `010-rowboat-api-service-plane.md`, while the repository contains
   `complete-010-rowboat-api-service-plane.md`.

## Summary

The implementation style can be summarized as:

> A schema-driven Go modular monolith using vertical feature packages, manual
> dependency injection, Ent-enforced tenancy, explicit state machines,
> immutable audit records, idempotent distributed operations, and
> Temporal-backed durable workflows.

The codebase's architectural center is the combination of request context, Ent
hooks and interceptors, and durable idempotency keys. Its abstractions are
intentionally asymmetric: database access stays concrete, while provider and
orchestration boundaries receive interfaces. The next architectural challenge
is decomposition for navigability rather than introducing more infrastructure
or generalized abstractions.
