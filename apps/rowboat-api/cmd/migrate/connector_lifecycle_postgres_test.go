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
	if _, err := db.ExecContext(ctx, `INSERT INTO connector_revocation_jobs(id,created_at,updated_at,connection_id,owner_id,connector,refresh_token_encrypted,credential_generation,terminal_status,terminal_reason,terminal_actor,status,attempts,next_attempt_at)
		VALUES(gen_random_uuid(),now(),now(),$1,$2,'dev-product',decode('010203','hex'),1,'invalidated','refresh_failed','system','pending',0,now())
		ON CONFLICT(connection_id) DO UPDATE SET refresh_token_encrypted=decode('010203','hex'),credential_generation=1,terminal_status='invalidated',terminal_reason='refresh_failed',terminal_actor='system',status='pending',attempts=0,next_attempt_at=now()`, connectionID, userID); err != nil {
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

func TestConnectorLifecyclePostgresTwoClientFencingAndClaim(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL is required")
	}
	db1, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db1.Close()
	db2, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db2.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	suffix := time.Now().UTC().Format("20060102150405.000000000")
	var userID, connectionID, jobID string
	if err := db1.QueryRowContext(ctx, `INSERT INTO users(id,created_at,updated_at,workos_user_id,email) VALUES(gen_random_uuid(),now(),now(),$1,$2) RETURNING id`, "lifecycle-"+suffix, "lifecycle-"+suffix+"@example.invalid").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	defer db1.ExecContext(context.Background(), `DELETE FROM users WHERE id=$1`, userID)
	if err := db1.QueryRowContext(ctx, `INSERT INTO mcp_connections(id,created_at,updated_at,connector,audience,scopes,refresh_token_encrypted,credential_generation,status,user_mcp_connections) VALUES(gen_random_uuid(),now(),now(),$1,$2,'[]',decode('01','hex'),1,'active',$3) RETURNING id`, "race-"+suffix, "race-api", userID).Scan(&connectionID); err != nil {
		t.Fatal(err)
	}
	if err := db1.QueryRowContext(ctx, `INSERT INTO connector_revocation_jobs(id,created_at,updated_at,connection_id,owner_id,connector,refresh_token_encrypted,credential_generation,terminal_status,terminal_reason,terminal_actor,status,attempts,next_attempt_at) VALUES(gen_random_uuid(),now(),now(),$1,$2,$3,decode('01','hex'),1,'revoked','user_disconnect','user','pending',0,now()) RETURNING id`, connectionID, userID, "race-"+suffix).Scan(&jobID); err != nil {
		t.Fatal(err)
	}

	start := make(chan struct{})
	var reconnectWinners atomic.Int32
	var wg sync.WaitGroup
	for i, db := range []*sql.DB{db1, db2} {
		wg.Add(1)
		go func(i int, db *sql.DB) {
			defer wg.Done()
			<-start
			res, execErr := db.ExecContext(ctx, `UPDATE mcp_connections SET credential_generation=credential_generation+1,refresh_token_encrypted=$1,updated_at=now() WHERE id=$2 AND credential_generation=1`, []byte{byte(i + 2)}, connectionID)
			if execErr == nil {
				if n, _ := res.RowsAffected(); n == 1 {
					reconnectWinners.Add(1)
				}
			}
		}(i, db)
	}
	close(start)
	wg.Wait()
	if reconnectWinners.Load() != 1 {
		t.Fatalf("reconnect CAS winners=%d, want 1", reconnectWinners.Load())
	}
	res, err := db1.ExecContext(ctx, `UPDATE mcp_connections SET status='revoked',refresh_token_encrypted=NULL WHERE id=$1 AND credential_generation=1`, connectionID)
	if err != nil {
		t.Fatal(err)
	}
	if n, _ := res.RowsAffected(); n != 0 {
		t.Fatal("stale revoke cleared replacement generation")
	}

	start = make(chan struct{})
	var claimWinners atomic.Int32
	for i, db := range []*sql.DB{db1, db2} {
		wg.Add(1)
		go func(i int, db *sql.DB) {
			defer wg.Done()
			<-start
			res, execErr := db.ExecContext(ctx, `UPDATE connector_revocation_jobs SET status='processing',claim_id=$1,claimed_until=now()+interval '2 minutes',updated_at=now() WHERE id=$2 AND status='pending'`, []string{"00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"}[i], jobID)
			if execErr == nil {
				if n, _ := res.RowsAffected(); n == 1 {
					claimWinners.Add(1)
				}
			}
		}(i, db)
	}
	close(start)
	wg.Wait()
	if claimWinners.Load() != 1 {
		t.Fatalf("revocation claim winners=%d, want 1", claimWinners.Load())
	}
}
