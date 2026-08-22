# Database, Ent, and migrations

## Source and generated flow

```text
ent/schema + generator config
        -> make generate
        -> Ent/history/OpenAPI/GraphQL/protobuf/TypeScript SDK artifacts
```

Schemas, mixins, generator configuration, enrichment code, and resolver
implementations are handwritten. Files with generated headers, generated Ent
CRUD, `internal/gqlapi/generated.go`, protobuf bindings, OpenAPI output, and
generated SDK files MUST NOT be edited directly. CI regenerates and checks
drift.

## Transactions

Use a transaction when writes jointly represent one invariant: entity plus
revision, reservation plus ledger, state plus decision/history, mutation plus
outbox, or identity decision plus lineage. Begin with the caller context, roll
back on every error before commit, commit once, and `Unwrap()` Ent entities that
will be traversed afterward. Design external effects outside a DB transaction;
use an outbox/state transition to bridge the boundary.

Append-only ledger, decision, lineage, revision, outcome, and trust records are
immutable. Corrections append compensating facts. State changes should use
compare-and-update predicates so concurrent/replayed work cannot overwrite a
newer state.

## Migration policy

SQLite/Ent auto-migration supports development and tests. Checked-in SQL under
`migrations/` is the production review/audit surface; production schema change
ownership must not rely on an accidental startup auto-migration.

A schema PR MUST include generated output and an operational migration plan.
Consider old/new binary compatibility, nullable/additive rollout, backfill
batches, table/index locks, large-table cost, destructive changes, deployment
order, recovery, and whether rollback is safe. Destructive or type-changing
migrations require staged expand/backfill/contract work. Migration filenames
remain ordered and immutable after deployment.

`make generate-check` requires generation dependencies and a clean worktree;
CI is authoritative for drift.
