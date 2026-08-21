# Testing standards

Tests are selected by risk rather than a fixed coverage percentage.

- Pure validation/state logic: table-driven unit tests, including invalid and boundary cases.
- Handlers: `httptest`, validation, status/problem code, authorization denial, response exposure.
- Persistence/invariants: SQLite-backed Ent integration tests; use Postgres when dialect/concurrency semantics matter.
- Tenant/auth changes: two-user cross-tenant read and mutation denial plus intentional internal behavior.
- Distributed operations: duplicate/replay, partial failure, crash/retry, stale compare-and-update, ambiguous provider results.
- Providers: fake HTTP services and contract-focused request/response/error tests.
- Temporal: workflow test environment for timers/signals/retries/cancellation; activities tested separately.
- Concurrency: deterministic coordination where possible and race detector coverage.

Bug fixes SHOULD begin with a failing regression test. Critical transitions
MUST test invalid transitions and replay, not only the happy path. Avoid sleeps
and live external services in the default suite; live tests require explicit
build tags/environment and documentation.

`make test` is the fast normal suite. `make test-race` runs in CI because full
race instrumentation is too expensive for each commit; targeted race tests are
appropriate during local concurrency work. The Postgres scheduler lease suite
continues to run separately with the `pgconcurrency` tag.
