package main

import (
	"os"
	"strings"
	"testing"

	entmigrate "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/migrate"
)

func TestConnectorBrokerHardeningMigrationCoversEntSchema(t *testing.T) {
	raw, err := os.ReadFile("../../migrations/postgres/20260827160000_connector_broker_hardening.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	for _, token := range []string{
		`"state_hash"`, `"lifecycle_status"`, `"requested_scopes"`, `"consent_challenge"`,
		`"context_request_id"`, `"hydra_client_id"`,
		`"status" character varying NOT NULL DEFAULT 'active'`, `"revoked_at"`,
		`"revocation_succeeded"`, `CREATE TABLE "connector_audit_events"`,
		`"event_id"`, `"consent_session_id"`, `"challenge"`, `"client_id"`, `"result"`, `"occurred_at"`,
		`CREATE UNIQUE INDEX "connector_audit_events_event_id_key"`,
		`FOREIGN KEY ("user_connector_audit_events") REFERENCES "users"`,
	} {
		if !strings.Contains(sql, token) {
			t.Fatalf("connector broker migration missing %q", token)
		}
	}

	var auditTableFound, pendingHashFound, tombstoneStatusFound bool
	for _, table := range entmigrate.Tables {
		switch table.Name {
		case "connector_audit_events":
			auditTableFound = true
		case "oauth_pendings":
			for _, column := range table.Columns {
				pendingHashFound = pendingHashFound || column.Name == "state_hash"
			}
		case "mcp_connections":
			for _, column := range table.Columns {
				tombstoneStatusFound = tombstoneStatusFound || column.Name == "status"
			}
		}
	}
	if !auditTableFound || !pendingHashFound || !tombstoneStatusFound {
		t.Fatalf("generated Ent schema missing broker tables/columns: audit=%v stateHash=%v status=%v", auditTableFound, pendingHashFound, tombstoneStatusFound)
	}
}
