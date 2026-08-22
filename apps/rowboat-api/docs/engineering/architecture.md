# Architecture

## System shape

Rowboat API is a modular monolith with shared Ent persistence and multiple
explicit process composition roots:

- `cmd/server`: chi HTTP, SSE, GraphQL, gRPC, health, metrics.
- `cmd/worker`: Temporal workflows and activities.
- `cmd/scheduler`: scheduled task admission and leases.
- `cmd/relationship-projector`: durable projections.
- `cmd/migrate`: schema application/dumps.
- `cmd/devstack`: local integrations and mocks.

Feature ownership lives in `internal/<feature>`. Handlers translate transport;
services own complex invariants; direct `*ent.Client` use is intentional. Do
not impose identical handler/service/provider files on simple packages.

## Dependency direction

`cmd` may depend on `internal`, `ent`, and `api`. `internal` must never depend
on `cmd`. Cross-feature imports are acceptable only when one package exposes a
narrow capability that is genuinely owned there; mutual domain dependencies
must be resolved by moving the shared concept to its true owner, not a generic
utility package. Go compilation enforces cycles; `make architecture` enforces
the composition-root direction.

External providers, workflow engines, clocks, and side effects are good
interface seams. Stable Ent persistence is concrete by design. Abstract
volatility, not every dependency.

## Composition and configuration

Manual wiring in `cmd/server/wire.go` is a deliberate, inspectable composition
root. New required dependencies belong in constructors or validated option
structures. Setter injection is reserved for optional capabilities and test
controls; it must not create a production object that silently operates in an
unsafe partial state.

`internal/appconfig.Config` is the typed environment boundary. Add fields in a
domain-cohesive section, validate production requirements at startup, define
safe defaults for development/tests, identify secrets, and document
deprecation. Do not read environment variables deep in features. The current
large config is a maintainability pressure; evolve it incrementally rather
than replacing it wholesale.

## Concentration points

`cmd/server/wire.go`, `internal/appconfig/config.go`, and large revenue handlers
and services are legitimate hot spots but need cohesion-based extraction.
Extract a route/wiring function or domain component when it owns a separable
concept with clear inputs—not solely because a file crossed a line threshold.
