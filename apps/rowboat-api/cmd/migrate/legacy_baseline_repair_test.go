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
	if _, err := atlasmigrate.Stmts(legacyIdentifierPrepareSQL); err != nil {
		t.Fatalf("parse identifier preparation SQL: %v", err)
	}
	for _, required := range []string{
		"revenueevidence_source_source__9c29dc0e2c6e018629a5b95c5f67b4cf",
		"relationship_attention_items_r_08f9696c627d891d88bc4d81e117365c",
	} {
		if !strings.Contains(legacyIdentifierPrepareSQL, required) {
			t.Errorf("identifier preparation SQL missing %q", required)
		}
	}
}
