package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	atlasmigrate "ariga.io/atlas/sql/migrate"
	_ "ariga.io/atlas/sql/postgres" // register the Atlas PostgreSQL driver
	"ariga.io/atlas/sql/sqlclient"
)

const (
	postgresRevisionTable = "atlas_schema_revisions"
	postgresMigrationLock = "rowboat_migrate_apply"
)

// applyPostgres executes the repository's checksummed Atlas-format files using
// Atlas's Go engine. Keeping execution in this binary avoids shipping a second
// executable in the production image while preserving Atlas history semantics.
func applyPostgres(ctx context.Context, databaseURL string) (err error) {
	client, err := sqlclient.Open(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("open PostgreSQL migration client: %w", err)
	}
	defer func() { err = errors.Join(err, client.Close()) }()

	unlock, err := client.Lock(ctx, postgresMigrationLock, time.Minute)
	if err != nil {
		return fmt.Errorf("acquire PostgreSQL migration lock: %w", err)
	}
	defer func() { err = errors.Join(err, unlock()) }()

	baseline, allowDirty, err := migrationState(ctx, client.DB)
	if err != nil {
		return err
	}
	revisions := &postgresRevisions{db: client.DB}
	if err := revisions.init(ctx); err != nil {
		return fmt.Errorf("initialize Atlas revision table: %w", err)
	}
	directory, err := atlasmigrate.NewLocalDir(postgresMigrationDir)
	if err != nil {
		return fmt.Errorf("open PostgreSQL migration directory: %w", err)
	}
	opts := make([]atlasmigrate.ExecutorOption, 0, 1)
	if baseline {
		opts = append(opts, atlasmigrate.WithBaselineVersion(postgresBaseline))
	} else if allowDirty {
		opts = append(opts, atlasmigrate.WithAllowDirty(true))
	}
	executor, err := atlasmigrate.NewExecutor(client.Driver, directory, revisions, opts...)
	if err != nil {
		return fmt.Errorf("create PostgreSQL migration executor: %w", err)
	}
	if err := executor.ExecuteN(ctx, 0); err != nil && !errors.Is(err, atlasmigrate.ErrNoPendingFiles) {
		return fmt.Errorf("apply PostgreSQL migrations: %w", err)
	}
	fmt.Println("PostgreSQL migrations applied")
	return nil
}

// migrationState distinguishes an existing auto-migrated Rowboat database
// from a genuinely empty schema. It runs before the revision table is
// initialized so an existing unversioned schema is recorded at the baseline.
func migrationState(ctx context.Context, database *sql.DB) (baseline, allowDirty bool, err error) {
	var revisionTable bool
	if err := database.QueryRowContext(ctx, `SELECT to_regclass('atlas_schema_revisions') IS NOT NULL`).Scan(&revisionTable); err != nil {
		return false, false, fmt.Errorf("inspect Atlas revision table: %w", err)
	}
	if revisionTable {
		return false, false, nil
	}
	var rowboatSchema bool
	if err := database.QueryRowContext(ctx, `
		SELECT to_regclass('users') IS NOT NULL
		    OR to_regclass('subscriptions') IS NOT NULL
	`).Scan(&rowboatSchema); err != nil {
		return false, false, fmt.Errorf("inspect existing PostgreSQL schema: %w", err)
	}
	if rowboatSchema {
		return true, false, nil
	}
	var userTables int
	if err := database.QueryRowContext(ctx, `
		SELECT count(*)
		FROM pg_tables
		WHERE schemaname = current_schema()
	`).Scan(&userTables); err != nil {
		return false, false, fmt.Errorf("inspect PostgreSQL user tables: %w", err)
	}
	return false, userTables == 0, nil
}

// postgresRevisions is wire-compatible with Atlas CLI's default PostgreSQL
// revision table, allowing existing deployments to switch executors in place.
type postgresRevisions struct {
	db *sql.DB
}

func (*postgresRevisions) Ident() *atlasmigrate.TableIdent {
	return &atlasmigrate.TableIdent{Name: postgresRevisionTable}
}

func (r *postgresRevisions) init(ctx context.Context) error {
	_, err := r.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS atlas_schema_revisions (
			version character varying NOT NULL PRIMARY KEY,
			description character varying NOT NULL,
			type bigint NOT NULL DEFAULT 2,
			applied bigint NOT NULL DEFAULT 0,
			total bigint NOT NULL DEFAULT 0,
			executed_at timestamptz NOT NULL,
			execution_time bigint NOT NULL,
			error text NULL,
			error_stmt text NULL,
			hash character varying NOT NULL,
			partial_hashes jsonb NULL,
			operator_version character varying NOT NULL
		)
	`)
	return err
}

func (r *postgresRevisions) ReadRevision(ctx context.Context, version string) (*atlasmigrate.Revision, error) {
	row := r.db.QueryRowContext(ctx, revisionSelect+` WHERE version = $1`, version)
	revision, err := scanRevision(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, atlasmigrate.ErrRevisionNotExist
	}
	return revision, err
}

func (r *postgresRevisions) ReadRevisions(ctx context.Context) ([]*atlasmigrate.Revision, error) {
	rows, err := r.db.QueryContext(ctx, revisionSelect+` ORDER BY version`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	revisions := make([]*atlasmigrate.Revision, 0)
	for rows.Next() {
		revision, err := scanRevision(rows.Scan)
		if err != nil {
			return nil, err
		}
		revisions = append(revisions, revision)
	}
	return revisions, rows.Err()
}

func (r *postgresRevisions) WriteRevision(ctx context.Context, revision *atlasmigrate.Revision) error {
	var partialHashes any
	if revision.PartialHashes != nil {
		encoded, err := json.Marshal(revision.PartialHashes)
		if err != nil {
			return fmt.Errorf("encode partial hashes: %w", err)
		}
		partialHashes = string(encoded)
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO atlas_schema_revisions (
			version, description, type, applied, total, executed_at,
			execution_time, error, error_stmt, hash, partial_hashes, operator_version
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (version) DO UPDATE SET
			description = EXCLUDED.description,
			type = EXCLUDED.type,
			applied = EXCLUDED.applied,
			total = EXCLUDED.total,
			executed_at = EXCLUDED.executed_at,
			execution_time = EXCLUDED.execution_time,
			error = EXCLUDED.error,
			error_stmt = EXCLUDED.error_stmt,
			hash = EXCLUDED.hash,
			partial_hashes = EXCLUDED.partial_hashes,
			operator_version = EXCLUDED.operator_version
	`, revision.Version, revision.Description, uint(revision.Type), revision.Applied, revision.Total,
		revision.ExecutedAt, int64(revision.ExecutionTime), revision.Error, revision.ErrorStmt,
		revision.Hash, partialHashes, revision.OperatorVersion)
	return err
}

func (r *postgresRevisions) DeleteRevision(ctx context.Context, version string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM atlas_schema_revisions WHERE version = $1`, version)
	if err != nil {
		return err
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if deleted == 0 {
		return atlasmigrate.ErrRevisionNotExist
	}
	return nil
}

const revisionSelect = `
	SELECT version, description, type, applied, total, executed_at,
	       execution_time, COALESCE(error, ''), COALESCE(error_stmt, ''),
	       hash, COALESCE(partial_hashes, '[]'::jsonb), operator_version
	FROM atlas_schema_revisions`

type scanFunc func(dest ...any) error

func scanRevision(scan scanFunc) (*atlasmigrate.Revision, error) {
	revision := &atlasmigrate.Revision{}
	var (
		revisionType  int64
		executionTime int64
		partialHashes []byte
	)
	if err := scan(
		&revision.Version, &revision.Description, &revisionType, &revision.Applied, &revision.Total,
		&revision.ExecutedAt, &executionTime, &revision.Error, &revision.ErrorStmt,
		&revision.Hash, &partialHashes, &revision.OperatorVersion,
	); err != nil {
		return nil, err
	}
	if revisionType < 0 {
		return nil, fmt.Errorf("invalid negative Atlas revision type %d", revisionType)
	}
	revision.Type = atlasmigrate.RevisionType(revisionType)
	revision.ExecutionTime = time.Duration(executionTime)
	if err := json.Unmarshal(partialHashes, &revision.PartialHashes); err != nil {
		return nil, fmt.Errorf("decode partial hashes: %w", err)
	}
	return revision, nil
}

var _ atlasmigrate.RevisionReadWriter = (*postgresRevisions)(nil)
