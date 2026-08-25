package main

import "testing"

func TestMigrationDatabaseURLPrefersDirectConnection(t *testing.T) {
	t.Setenv("MIGRATION_DATABASE_URL", "postgres://direct")

	if got := migrationDatabaseURL("postgres://pooled"); got != "postgres://direct" {
		t.Fatalf("expected direct migration URL, got %q", got)
	}
}

func TestMigrationDatabaseURLFallsBackToRuntimeConnection(t *testing.T) {
	t.Setenv("MIGRATION_DATABASE_URL", "")

	if got := migrationDatabaseURL("postgres://pooled"); got != "postgres://pooled" {
		t.Fatalf("expected runtime fallback URL, got %q", got)
	}
}
