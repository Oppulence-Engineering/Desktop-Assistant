package main

import (
	"os"
	"strings"
	"testing"
)

func TestConnectionHistorySecretPurgeMigrationContract(t *testing.T) {
	raw, err := os.ReadFile("../../migrations/postgres/20260828014500_connection_history_secret_purge.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	for _, required := range []string{
		`UPDATE "mcp_connection_histories"`,
		`UPDATE "oauth_connection_histories"`,
		`NEW."refresh_token_encrypted" := NULL`,
		`NEW."api_key_encrypted" := NULL`,
		`CHECK ("refresh_token_encrypted" IS NULL)`,
		`CHECK ("api_key_encrypted" IS NULL)`,
		`rowboat_redact_mcp_history_credentials`,
		`rowboat_redact_oauth_history_credentials`,
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("migration missing %q", required)
		}
	}
	if purge := strings.Index(sql, `SET "refresh_token_encrypted" = NULL`); purge < 0 {
		t.Fatal("migration does not purge history credentials")
	} else if guard := strings.Index(sql, `CHECK ("refresh_token_encrypted" IS NULL)`); guard < purge {
		t.Fatal("history NULL guard precedes authoritative purge")
	}
}
