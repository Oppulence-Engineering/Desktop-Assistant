package main

import "testing"

func TestMigrationDatabaseURLPrefersDirectConnection(t *testing.T) {
	const pooled = "postgres://app@db:25061/rowboat"
	t.Setenv("MIGRATION_DATABASE_URL", "")
	if got := migrationDatabaseURL(pooled); got != pooled {
		t.Fatalf("without MIGRATION_DATABASE_URL got %q, want %q", got, pooled)
	}

	const direct = "postgres://admin@db:25060/rowboat"
	t.Setenv("MIGRATION_DATABASE_URL", direct)
	if got := migrationDatabaseURL(pooled); got != direct {
		t.Fatalf("with MIGRATION_DATABASE_URL got %q, want %q", got, direct)
	}
}
