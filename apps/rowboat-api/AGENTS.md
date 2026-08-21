# Rowboat API agent contract

This file is the authoritative entry point for every coding agent working in
`apps/rowboat-api`. Read it before making changes. More detailed standards and
rationale live in [`docs/engineering`](docs/engineering/README.md).

## Mandatory validation

> **Every code, configuration, schema, migration, test, tooling, or
> documentation change MUST be validated by running `make verify` from
> `apps/rowboat-api` after the final edit.**

- An agent **MUST NOT** claim that work is complete unless `make verify` has
  passed against the final working tree.
- Running individual checks while iterating does not replace the final
  `make verify`.
- An agent **MUST NOT** weaken, remove, skip, or broadly suppress a check merely
  to make validation pass.
- If `make verify` cannot run or fails for a reason outside the change, report
  the exact command, failure, and remaining risk. Never describe an unrun or
  failing check as passing.
- Run `make verify-ci` as well for security-sensitive, dependency, CI,
  release, concurrency, or deployment changes. It adds race, vulnerability,
  and full secret-history checks.

## Required workflow

1. Inspect the owning package, its tests, and the relevant engineering
   documentation before editing.
2. Write concrete acceptance criteria before implementation. Identify the
   business invariant, trust boundary, persisted outcome, retry behavior, and
   user-visible failure behavior affected by the change.
3. Make the smallest coherent change. Preserve unrelated work and report
   unrelated findings instead of fixing them opportunistically.
4. Modify source inputs rather than generated output.
5. Add tests that execute the production business logic and prove the acceptance
   criteria. A test that only proves routing, mocking, or compilation is not
   sufficient.
6. Run focused checks during development.
7. After the final edit, run `make verify`.
8. Report the validation commands and their results truthfully.

## Feature implementation contract

Agents **MUST** implement features as complete production paths, not isolated
snippets. Before editing, trace the relevant path from entry point through
authorization, domain logic, persistence or workflow orchestration, external
effects, and response/event delivery.

- **MUST** define observable acceptance criteria for success, validation
  failure, authorization failure, dependency failure, duplicate execution, and
  cancellation where applicable.
- **MUST** locate and reuse the existing domain types, state transitions,
  tenancy helpers, outbound clients, transaction patterns, workflow patterns,
  and error vocabulary before creating new abstractions.
- **MUST** implement and wire every required layer: route or consumer
  registration, dependency construction, service/domain behavior, persistence,
  migrations or generation, workflow/activity registration, metrics, and
  response/event mapping as applicable.
- **MUST** preserve the business invariant across the entire operation. Partial
  success must either be impossible through a transaction or represented by an
  explicit, recoverable state.
- **MUST** make validation and authorization fail closed before mutating state or
  starting external work.
- **MUST** preserve backward compatibility for public APIs, persisted data,
  workflow histories, events, and provider contracts unless the task explicitly
  authorizes a breaking change and includes a migration plan.
- **MUST NOT** ship placeholders, fake success responses, hard-coded production
  values, empty implementations, `panic("not implemented")`, unresolved feature
  TODOs, or silent fallbacks that conceal missing behavior.
- **MUST NOT** treat a handler returning the expected status, a mock being
  called, or the code compiling as evidence that the feature works.
- **MUST NOT** introduce an interface, mock, wrapper, or generic abstraction only
  to make a test easier. Test through the real domain implementation and fake
  only true external boundaries.
- **MUST** inspect the final diff for incomplete wiring, ignored errors, missing
  registration, accidental generated edits, and unrelated changes before
  running the mandatory verification gate.

## Architecture

Rowboat API is a schema-driven Go modular monolith. It uses vertical feature
packages, manual dependency injection, direct Ent persistence, Ent-enforced
tenant isolation, explicit state machines, immutable audit records, idempotent
distributed operations, and Temporal-backed durable workflows.

- **MUST** keep feature behavior in `internal/<feature>` and process
  composition in `cmd/<process>`.
- **MUST NOT** import `cmd/*` from `internal/*` or `tools/*`.
- **MUST** preserve explicit dependency injection.
- **MUST NOT** introduce a DI framework, generic repository layer, premature
  microservice, or interface for a stable internal dependency without a real
  volatility or testing seam.
- **SHOULD** make required dependencies constructor arguments or validated
  configuration. Production objects should be valid immediately after
  construction.
- **MAY** use setters for optional capabilities and test-only clocks.
- **MUST NOT** create generic `utils`, `helpers`, or `common` dumping
  grounds. Shared packages need a narrow capability name and multiple real
  consumers.
- **SHOULD** split packages and files by cohesive domain responsibility, not
  arbitrary size thresholds.

Prefer the existing principle:

> Abstract volatility, not every dependency.

## Security and tenancy

- **MUST** propagate the caller's context through every I/O boundary.
- **MUST NOT** use `context.Background()` or `context.TODO()` inside request,
  activity, or service call paths.
- **MUST** preserve Ent read interceptors and mutation hooks for every
  tenant-owned schema.
- **MUST** treat `auth.WithInternal` and `auth.WithInternalOnly` as privileged
  capabilities, never convenience helpers.
- **MUST** test tenant isolation when changing schemas, identity context,
  hooks/interceptors, privileged execution, or administration paths.
- **MUST** give every route an explicit trust class: public, token-scoped,
  authenticated, provider-verified, HMAC, internal-secret, or step-up.
- **MUST** fail closed when required authorization state or identity is absent.
- **MUST** test credential rejection and authorization denial paths.
- **MUST NOT** log credentials, bearer tokens, cookies, secrets, private keys,
  raw sensitive payloads, or authentication material.
- **MUST** use explicit response DTOs when persistence entities contain internal
  or sensitive fields.

## Persistence and distributed operations

- **MUST** answer “what happens if this runs twice?” for webhooks, activities,
  schedules, queues, provider mutations, payments, events, actions, and quota
  operations.
- **MUST** make retryable side effects idempotent with an appropriate mechanism:
  a uniqueness constraint, deterministic ID, guarded transition, content hash,
  immutable revision, or provider idempotency key.
- **MUST NOT** blindly retry a non-idempotent outbound request.
- **MUST** use explicit, guarded state transitions and typed or sentinel errors
  for invalid transitions.
- **MUST** use a transaction when multiple writes form one business invariant.
- **MUST** roll back every pre-commit error. After commit, call `Unwrap()` on
  transactional Ent entities that will be queried.
- **MUST NOT** mutate append-only audit or history records. Corrections are new
  compensating records.
- **MUST** treat migrations as production operations: consider compatibility,
  backfills, locks, index cost, rollout order, and recovery.

## Temporal workflows

- **MUST** use Temporal when an operation must survive process restarts, wait for
  external events or humans, run on a durable schedule, coordinate multiple
  retryable effects, or remain observable as long-running business state.
- **MUST NOT** introduce a workflow for a synchronous request that can be safely
  completed by one service operation or database transaction.
- **MUST** keep workflows as deterministic orchestration. Workflow code may
  branch only on workflow inputs, recorded results, signals/updates, and
  Temporal deterministic APIs.
- **MUST** use `workflow.Context` and Temporal APIs in workflows. Use
  `workflow.Now`, `workflow.Sleep`, workflow futures/selectors, and
  `workflow.Go` rather than standard-library equivalents.
- **MUST NOT** perform network, database, filesystem, environment/configuration,
  wall-clock, random/UUID, process, or other external side effects in workflow
  code. These belong in activities.
- **MUST NOT** use native goroutines, `time.Now`, `time.Sleep`, `rand`,
  `uuid.New`, `net/http`, `os`, mutable globals, or nondeterministic map
  iteration when it affects emitted commands.
- **MUST** pass serializable, bounded workflow/activity inputs. Pass identifiers
  or immutable snapshots—not clients, Ent entities, request contexts, closures,
  or unbounded payloads.
- **MUST** assign a stable workflow ID derived from the durable business
  identity and explicitly define duplicate-start behavior. Random workflow IDs
  are forbidden for logically unique operations.
- **MUST** choose deliberate activity timeouts, retry policy, cancellation
  behavior, and heartbeat behavior. Do not rely blindly on defaults for
  external mutations or long-running work.
- **MUST** classify permanent errors as non-retryable and bound transient
  retries. A retry policy must match the provider and business semantics.
- **MUST** make every activity safe to execute more than once. Provider writes
  require a stable idempotency key or an explicit reconciliation strategy for
  ambiguous outcomes such as timeouts after remote success.
- **MUST** heartbeat long-running activities with resumable progress and honor
  cancellation. Cancellation must leave persisted state truthful and perform
  compensation when the business invariant requires it.
- **MUST** validate and deduplicate signals/updates, handle out-of-order delivery,
  and keep queries side-effect free.
- **MUST** control event-history growth with bounded payloads and
  `ContinueAsNew` when workflows can run indefinitely or process unbounded
  events.
- **MUST** preserve replay compatibility. Before changing command order,
  activity/child-workflow types, timers, branching, or signal handling, decide
  whether the change is replay-safe; use `workflow.GetVersion` or an approved
  worker-versioning strategy when it is not.
- **MUST NOT** remove an existing version marker until no retained execution can
  replay the old branch.
- **MUST** register new workflows and activities in every relevant worker and
  verify that starters use the intended task queue, workflow ID, and options.
- **MUST** test the actual workflow function with Temporal's test environment.
  Mocking a workflow wrapper without executing workflow code is insufficient.
- **MUST** test orchestration success plus applicable activity failure/retry,
  duplicate signal/update, cancellation, timer, child-workflow, and
  continue-as-new behavior.
- **MUST** test activity business logic separately with real validation and
  persistence code, faking only external providers. Assert idempotency under
  repeated execution.
- **MUST** run replay tests against representative saved histories when changing
  an existing production workflow in a replay-sensitive way.

See [`docs/engineering/temporal.md`](docs/engineering/temporal.md).

## Go and API standards

- **MUST** use `goimports`; `make fmt` is the canonical formatter.
- **MUST** handle errors explicitly, preserve causes with `%w`, and use
  `errors.Is` or `errors.As` for semantic checks.
- **MUST NOT** use panic for ordinary application control flow.
- **MUST** give goroutines clear ownership, bounded concurrency, cancellation,
  and deterministic cleanup.
- **MUST** close response bodies, SQL rows, files, spans, and other acquired
  resources.
- **MUST** validate request bodies, bound reads, return stable RFC 9457 problem
  codes, use correct status codes, and paginate unbounded collections.
- **SHOULD** keep transport translation in handlers and domain invariants in
  services when behavior is non-trivial. Simple handlers may remain simple.
- **MUST** use the shared outbound policy where applicable, including deadlines,
  cancellation, bounded responses, concurrency limits, and
  idempotency-sensitive retries.

## Business-logic testing

Tests are executable evidence of business behavior. Coverage percentage, mock
call counts, snapshots, and “no error” assertions are not substitutes for that
evidence.

- **MUST** add a regression test that fails before every bug fix and passes
  because of the fix.
- **MUST** execute the real production handler/service/domain/workflow function
  containing the changed invariant. Tests must not reimplement the algorithm or
  validate a test-only copy of the logic.
- **MUST** assert business outcomes: persisted records and fields, state
  transitions, emitted immutable events, quota/ledger effects, provider request
  semantics, idempotency keys, returned domain errors, and absence of forbidden
  side effects.
- **MUST** test success and all material failure classes: invalid input,
  unauthenticated/unauthorized access, wrong tenant, missing dependency,
  invalid state transition, transaction rollback, provider timeout/failure,
  duplicate delivery, retry, cancellation, and concurrency conflict as
  applicable.
- **MUST** verify that failure paths do not partially mutate state, emit events,
  consume quota, or call providers unless the contract explicitly requires it.
- **MUST** use real Ent test persistence when behavior depends on schemas,
  constraints, hooks, interceptors, queries, transactions, or state transitions.
  A mocked repository is insufficient for those behaviors.
- **MUST** use Postgres-backed tests when correctness depends on Postgres
  locking, isolation, indexes, constraints, or concurrent transactions that
  SQLite cannot faithfully represent.
- **MUST** test tenant isolation with at least two tenants and prove both that
  cross-tenant reads are hidden and cross-tenant writes are rejected.
- **MUST** fake providers at the narrow outbound boundary and assert the complete
  semantically relevant request, including identity, payload, deadline,
  idempotency key, and retry behavior. Avoid mocking internal collaborators.
- **MUST** make duplicate/retry tests execute the operation more than once and
  assert one durable business effect, not merely one mock invocation.
- **MUST** write deterministic tests: control clocks, IDs, randomness, and
  scheduling through established seams; never fix flakes with arbitrary sleeps
  or retries.
- **MUST NOT** weaken assertions, delete coverage, add broad skips, or change
  production semantics merely to make a test pass.
- **MUST NOT** count tests that assert only HTTP status, non-nil output, absence
  of error, JSON shape, snapshot text, or mock invocation as sufficient feature
  coverage. These may supplement—but never replace—business assertions.
- **MUST** choose additional tests based on risk: handler, provider contract,
  Temporal workflow/activity, race, migration, authorization, and end-to-end
  composition tests.

## Generated code

- **MUST NOT** manually edit generated Ent, gqlgen, protobuf, OpenAPI, or SDK
  artifacts.
- **MUST** change the schema/configuration/source input, run `make generate`,
  and commit both the source and generated results when generation is required.

## Enforcement rules

- Lint suppressions **MUST** name the linter and include a specific reason:
  `//nolint:<name> // reason`.
- Suppressions **MUST** be placed on the narrowest possible line. Broad
  file/package exclusions require a documented rationale in `.golangci.yml`.
- New enforcement rules **MUST** identify the defect class, include positive and
  negative fixtures where applicable, and start from a clean baseline.
- Changes to `Makefile`, `.golangci.yml`, `arch-go.yml`, `sgconfig.yml`,
  `rules/**`, `policy/**`, `tools/rowboatlint/**`, `lefthook.yml`, or the
  quality workflow are protection-layer changes and require
  `make verify-ci`.

## Commands

```bash
make fmt           # Rewrite handwritten Go with goimports
make lint          # Run the pinned golangci-lint suite, including gosec
make architecture  # Run tenant registry and Arch-Go topology checks
make rowboatlint   # Run typed Rowboat-specific analyzers and fixtures
make ruleguard     # Run custom Go AST rules
make structural    # Run ast-grep structural policies
make policy        # Test CI policy and Rego rules
make test          # Run the normal Go test suite
make test-race     # Run the full race-enabled suite
make security      # Run govulncheck and full-history Gitleaks
make verify        # REQUIRED final validation for every change
make verify-ci     # Extended race/security validation for higher-risk changes
```

## Definition of done

A change is complete only when:

- every acceptance criterion is implemented through the real production path;
- the implementation preserves the rules and business invariants above;
- tests execute the actual business logic and assert durable outcomes plus
  material failure, duplicate, retry, and cancellation behavior;
- Temporal changes are deterministic, replay-compatible, idempotent, registered,
  and tested with the Temporal test environment where applicable;
- generated artifacts, documentation, and migrations are synchronized;
- **`make verify` has passed after the final edit**;
- `make verify-ci` has passed when required by this contract; and
- the final report names every validation command run and discloses any skipped
  or failing check.

For deeper guidance, see:

- [Architecture](docs/engineering/architecture.md)
- [Coding standards](docs/engineering/coding-standards.md)
- [Security](docs/engineering/security.md)
- [Database](docs/engineering/database.md)
- [Temporal](docs/engineering/temporal.md)
- [API design](docs/engineering/api-design.md)
- [Testing](docs/engineering/testing.md)
- [Code review](docs/engineering/code-review.md)
- [Executable policy system](docs/engineering/policy-system.md)
