package main

import (
	"os"
	"strings"
	"testing"

	entmigrate "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/migrate"
)

func TestConnectorCredentialRecoveryMigrationMatchesEntSchema(t *testing.T) {
	raw, err := os.ReadFile("../../migrations/postgres/20260828013000_connector_credential_recovery.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	for _, token := range []string{
		`CREATE TABLE "connector_credential_recoveries"`,
		`"refresh_token_encrypted" bytea NOT NULL`,
		`"owner_kind" varchar NOT NULL`,
		`"owner_id" varchar NOT NULL`,
		`"status" varchar NOT NULL DEFAULT 'pending'`,
		`CREATE INDEX "connectorcredentialrecovery_status_next_attempt_at"`,
	} {
		if !strings.Contains(sql, token) {
			t.Fatalf("credential recovery migration missing %q", token)
		}
	}
	for _, table := range entmigrate.Tables {
		if table.Name != "connector_credential_recoveries" {
			continue
		}
		columns := map[string]bool{}
		for _, column := range table.Columns {
			columns[column.Name] = true
		}
		for _, required := range []string{"id", "connector", "owner_kind", "owner_id", "refresh_token_encrypted", "status", "next_attempt_at", "claim_id", "claimed_until"} {
			if !columns[required] {
				t.Fatalf("generated recovery table missing %q", required)
			}
		}
		return
	}
	t.Fatal("generated Ent schema is missing connector_credential_recoveries")
}
