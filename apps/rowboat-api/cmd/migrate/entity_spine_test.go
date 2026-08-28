package main

import (
	"os"
	"strings"
	"testing"
)

func TestEntitySpineMigrationHasNormalizedTenantIndexes(t *testing.T) {
	raw, err := os.ReadFile("../../migrations/postgres/20260827130000_entity_spine.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	for _, required := range []string{
		`CREATE TABLE "entities"`,
		`CREATE TABLE "entity_resource_refs"`,
		`CREATE TABLE "entity_identifiers"`,
		`CREATE UNIQUE INDEX "entityresourceref_ref_revenue_workspace_id"`,
		`CREATE INDEX "entityidentifier_key_fingerprint_revenue_workspace_id"`,
		`"canonical_entity_id" varchar NULL`,
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("entity spine migration missing %q", required)
		}
	}
	if strings.Contains(sql, `UNIQUE INDEX "entityidentifier_key_fingerprint_revenue_workspace_id"`) {
		t.Fatal("identifier fingerprints must permit reviewable workspace ambiguity")
	}
}
