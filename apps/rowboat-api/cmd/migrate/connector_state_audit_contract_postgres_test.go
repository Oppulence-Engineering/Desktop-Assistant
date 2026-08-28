package main

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

func TestConnectorStateAuditContractPopulatedPostgres(t *testing.T) {
	dsn := os.Getenv("MIGRATION_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("MIGRATION_TEST_DATABASE_URL is required for populated PostgreSQL migration validation")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	ctx := context.Background()
	schema := "connector_contract_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := db.ExecContext(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = db.ExecContext(ctx, `DROP SCHEMA `+schema+` CASCADE`) }()
	if _, err := db.ExecContext(ctx, `SET search_path TO `+schema); err != nil {
		t.Fatal(err)
	}
	_, err = db.ExecContext(ctx, `
CREATE TABLE oauth_pendings (state varchar NOT NULL UNIQUE, state_hash varchar NULL UNIQUE, expires_at timestamptz NOT NULL);
CREATE TABLE connector_audit_events (id uuid PRIMARY KEY, event_type varchar NOT NULL);
INSERT INTO oauth_pendings VALUES ('raw-live-bearer', NULL, now() + interval '5 minutes'), ('raw-expired-bearer', NULL, now() - interval '1 minute');
INSERT INTO connector_audit_events VALUES ('00000000-0000-0000-0000-000000000001', 'oauth_started');`)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../migrations/postgres/20260828030000_connector_state_and_audit_contract.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, string(raw)); err != nil {
		t.Fatal(err)
	}
	// Retry proves operational idempotence.
	if _, err := db.ExecContext(ctx, string(raw)); err != nil {
		t.Fatal(err)
	}
	var state, hash string
	if err := db.QueryRowContext(ctx, `SELECT state, state_hash FROM oauth_pendings`).Scan(&state, &hash); err != nil {
		t.Fatal(err)
	}
	if state != "sha256:"+hash || strings.Contains(state, "raw-live-bearer") {
		t.Fatalf("raw state survived contract migration: %q", state)
	}
	var count int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM oauth_pendings`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("expired rows not purged: count=%d err=%v", count, err)
	}
	for _, statement := range []string{
		`UPDATE connector_audit_events SET event_type='tampered'`,
		`DELETE FROM connector_audit_events`,
	} {
		if _, err := db.ExecContext(ctx, statement); err == nil || !strings.Contains(err.Error(), "append-only") {
			t.Fatalf("audit tamper was not rejected for %q: %v", statement, err)
		}
	}
	var unchanged string
	if err := db.QueryRowContext(ctx, `SELECT event_type FROM connector_audit_events`).Scan(&unchanged); err != nil || unchanged != "oauth_started" {
		t.Fatalf("audit row changed after tamper attempts: value=%q err=%v", unchanged, err)
	}
}
