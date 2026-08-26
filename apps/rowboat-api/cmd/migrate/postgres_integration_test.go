//go:build pgconcurrency

package main

import (
	"context"
	"database/sql"
	"os"
	"testing"
)

func TestApplyPostgresIsIdempotent(t *testing.T) {
	dsn := os.Getenv("ROWBOAT_TEST_PG_DSN")
	if dsn == "" {
		t.Skip("ROWBOAT_TEST_PG_DSN not set; skipping PostgreSQL migration test")
	}
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir("../.."); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(workingDirectory) })

	if err := validateDirectory(); err != nil {
		t.Fatal(err)
	}
	if err := applyPostgres(context.Background(), dsn); err != nil {
		t.Fatalf("first migration apply: %v", err)
	}
	if err := applyPostgres(context.Background(), dsn); err != nil {
		t.Fatalf("idempotent migration apply: %v", err)
	}

	database, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	var revisions int
	if err := database.QueryRowContext(context.Background(), `SELECT count(*) FROM atlas_schema_revisions`).Scan(&revisions); err != nil {
		t.Fatal(err)
	}
	if revisions != 5 {
		t.Fatalf("expected 5 applied revisions, got %d", revisions)
	}
}
