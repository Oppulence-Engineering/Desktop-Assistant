# Database migrations

`postgres/` is the authoritative production migration directory. Its SQL files
are ordered, reviewed, and protected by `atlas.sum`.

Common commands:

```bash
make migration-validate
make migration-lint
make migrate-diff name=add_example_field MIGRATION_DEV_URL='postgres://...'
make migrate-apply DATABASE_URL='postgres://...'
```

PostgreSQL application processes never auto-migrate. Deployment runs
`cmd/migrate apply`, which baselines databases created by the former Ent
auto-migration path and applies pending Atlas migrations. SQLite continues to
use Ent auto-migration for local development and tests.

The SQL files directly under `migrations/` are legacy SQLite snapshots. They
remain for historical reference and are not applied to PostgreSQL.
