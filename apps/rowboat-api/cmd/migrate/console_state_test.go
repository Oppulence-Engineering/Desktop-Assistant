package main

import (
	"os"
	"strings"
	"testing"
)

func TestConsoleStateMigrationPreservesIsolationUniquenessAndCascades(t *testing.T) {
	raw, err := os.ReadFile("../../migrations/postgres/20260917210500_console_state.sql")
	if err != nil {
		t.Fatalf("read console migration: %v", err)
	}
	sql := string(raw)
	required := []string{
		`CREATE TABLE "user_preferences"`,
		`CREATE TABLE "console_resources"`,
		`CHECK ("kind" IN ('note_template', 'note_favorite', 'graph_saved_view'))`,
		`"userpreference_user_user_preferences"`,
		`"consoleresource_kind_name_key_revenue_workspace_id_user_console_resources"`,
		`"consoleresource_kind_note_id_revenue_workspace_id_user_console_resources"`,
		`FOREIGN KEY ("user_user_preferences") REFERENCES "users" ("id")`,
		`FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id")`,
		`FOREIGN KEY ("user_console_resources") REFERENCES "users" ("id")`,
	}
	for _, token := range required {
		if !strings.Contains(sql, token) {
			t.Errorf("console migration missing %q", token)
		}
	}
	if got := strings.Count(sql, "ON UPDATE NO ACTION ON DELETE CASCADE"); got != 3 {
		t.Fatalf("console migration has %d cascading foreign keys, want 3", got)
	}
}
