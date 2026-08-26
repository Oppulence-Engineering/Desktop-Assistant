package main

import (
	"os"
	"strings"
	"testing"
)

func TestRelationshipAssertionAuthorityMigrationIsRollingDeploySafe(t *testing.T) {
	raw, err := os.ReadFile("../../migrations/postgres/20260826090000_relationship_assertion_authority.sql")
	if err != nil {
		t.Fatalf("read relationship assertion authority migration: %v", err)
	}
	sql := strings.ToLower(string(raw))
	for _, unsafe := range []string{
		`set "status" = 'accepted'`,
		`alter column "status" set default 'accepted'`,
	} {
		if strings.Contains(sql, unsafe) {
			t.Fatalf("migration is unsafe while legacy projectors still select status=active: found %q", unsafe)
		}
	}
	for _, required := range []string{
		`legacy relationship assertions violate value schema v1`,
		`"value" <> btrim("value")`,
		`octet_length(btrim("value")) > 4096`,
		`"dimension" not in`,
		`"source_type" not in`,
		`"dimension" = 'lifecycle'`,
		`"dimension" = 'engagement'`,
		`"dimension" = 'sentiment'`,
		`"dimension" = 'health'`,
		`add column "authority_rank"`,
		`add column "value_schema_version"`,
		`add column "reviewer_id"`,
		`create index "relationshipassertion_authority_rank_valid_from_relationship_id"`,
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("migration is missing required additive change %q", required)
		}
	}
}
