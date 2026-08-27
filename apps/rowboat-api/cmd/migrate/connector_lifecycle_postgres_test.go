//go:build postgresintegration

package main

import (
	"context"
	"database/sql"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// These regressions intentionally exercise PostgreSQL row locking and commit
// behavior. Run migrations first and start application processes with
// AUTO_MIGRATE=false.
func TestConnectorLifecyclePostgresConcurrencyCrashAndRetry(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var userID string
	if err := db.QueryRowContext(ctx, `INSERT INTO users(id,created_at,updated_at,workos_user_id,email)
		VALUES(gen_random_uuid(),now(),now(),'connector-pg-regression','connector-pg-regression@example.invalid')
		ON CONFLICT(workos_user_id) DO UPDATE SET updated_at=now() RETURNING id`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	state := "sha256:connector-pg-race"
	if _, err := db.ExecContext(ctx, `DELETE FROM oauth_pendings WHERE state=$1`, state); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO oauth_pendings(id,created_at,updated_at,state,state_hash,provider,payload_encrypted,expires_at,lifecycle_status)
		VALUES(gen_random_uuid(),now(),now(),$1,'connector-pg-race','dev-product',decode('00','hex'),now()+interval '10 minutes','callback_completed')`, state); err != nil {
		t.Fatal(err)
	}

	var winners atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, execErr := db.ExecContext(ctx, `UPDATE oauth_pendings SET lifecycle_status='claimed',claimed_at=now(),updated_at=now() WHERE state=$1 AND lifecycle_status='callback_completed'`, state)
			if execErr != nil {
				return
			}
			if n, _ := res.RowsAffected(); n == 1 {
				winners.Add(1)
			}
		}()
	}
	wg.Wait()
	if winners.Load() != 1 {
		t.Fatalf("claim race had %d winners, want 1", winners.Load())
	}

	// The dedicated outbox preserves the sealed provider credential while the
	// locally disabled connection is scrubbed immediately.
	var connectionID string
	if err := db.QueryRowContext(ctx, `INSERT INTO mcp_connections(id,created_at,updated_at,connector,audience,scopes,refresh_token_encrypted,status,connected_at,user_mcp_connections)
		VALUES(gen_random_uuid(),now(),now(),'dev-product','dev-product-api','[]',decode('010203','hex'),'invalidated',now(),$1)
		ON CONFLICT(connector,user_mcp_connections) DO UPDATE SET status='invalidated',refresh_token_encrypted=NULL,revocation_succeeded=false
		RETURNING id`, userID).Scan(&connectionID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO connector_revocation_jobs(id,created_at,updated_at,connection_id,owner_id,connector,refresh_token_encrypted,status,attempts,next_attempt_at)
		VALUES(gen_random_uuid(),now(),now(),$1,$2,'dev-product',decode('010203','hex'),'pending',0,now())
		ON CONFLICT(connection_id) DO UPDATE SET refresh_token_encrypted=decode('010203','hex'),status='pending',attempts=0,next_attempt_at=now()`, connectionID, userID); err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE connector_revocation_jobs SET attempts=attempts+1,updated_at=now() WHERE connection_id=$1`, connectionID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	var retained int
	if err := db.QueryRowContext(ctx, `SELECT octet_length(refresh_token_encrypted) FROM connector_revocation_jobs WHERE connection_id=$1`, connectionID).Scan(&retained); err != nil {
		t.Fatal(err)
	}
	if retained == 0 {
		t.Fatal("worker crash erased credential before durable revocation success")
	}

	res, err := db.ExecContext(ctx, `DELETE FROM connector_revocation_jobs WHERE connection_id=$1 AND status='pending'`, connectionID)
	if err != nil {
		t.Fatal(err)
	}
	if n, _ := res.RowsAffected(); n != 1 {
		t.Fatalf("retry completion updated %d rows, want 1", n)
	}
	res, err = db.ExecContext(ctx, `DELETE FROM connector_revocation_jobs WHERE connection_id=$1 AND status='pending'`, connectionID)
	if err != nil {
		t.Fatal(err)
	}
	if n, _ := res.RowsAffected(); n != 0 {
		t.Fatalf("completed revocation was not idempotent: %d rows", n)
	}
}
