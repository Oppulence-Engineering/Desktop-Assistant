package main

import (
	"strings"
	"testing"

	atlasmigrate "ariga.io/atlas/sql/migrate"
)

func TestLegacyBaselineRepairCoversCutoverGap(t *testing.T) {
	if _, err := atlasmigrate.Stmts(legacyBaselineRepairSQL); err != nil {
		t.Fatalf("parse repair SQL: %v", err)
	}
	for _, required := range []string{
		`ADD COLUMN IF NOT EXISTS "state_hash"`,
		`ADD COLUMN IF NOT EXISTS "template_slug"`,
		`CREATE TABLE IF NOT EXISTS "relationship_persons"`,
		`CREATE TABLE IF NOT EXISTS "relationship_attention_items"`,
		`CREATE TABLE IF NOT EXISTS "relationship_projection_jobs"`,
		`CREATE TABLE IF NOT EXISTS "person_suppressions"`,
	} {
		if !strings.Contains(legacyBaselineRepairSQL, required) {
			t.Errorf("repair SQL missing %q", required)
		}
	}
}
