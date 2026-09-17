package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	entschema "entgo.io/ent/dialect/sql/schema"

	generated "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/migrate"
)

const (
	cascadeMigrationFile  = "20260915173435_account_delete_cascade.sql"
	validateMigrationFile = "20260915173436_account_delete_cascade_validate.sql"
)

var (
	cascadeStatementPattern  = regexp.MustCompile(`^ALTER TABLE "([a-z_]+)" DROP CONSTRAINT "([a-z0-9_]+)", ADD CONSTRAINT "([a-z0-9_]+)" FOREIGN KEY \("([a-z_]+)"\) REFERENCES "(users|revenue_workspaces)" \("id"\) ON UPDATE NO ACTION ON DELETE CASCADE NOT VALID;$`)
	validateStatementPattern = regexp.MustCompile(`^ALTER TABLE "([a-z_]+)" VALIDATE CONSTRAINT "([a-z0-9_]+)";$`)
)

func accountDeleteStatements(t *testing.T, name string) []string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "migrations", "postgres", name))
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "--") {
			continue
		}
		out = append(out, line)
	}
	return out
}

type cascadeFK struct{ table, column, parent string }

// TestAccountDeleteCascadeMigrationMatchesTheEntSchema pins the hand-trimmed
// Atlas output: it rewrites exactly the foreign keys that the Ent schema says
// cascade, and nothing else (no CHECK, index, or column drift).
func TestAccountDeleteCascadeMigrationMatchesTheEntSchema(t *testing.T) {
	// Tables introduced after the corrective migration declare CASCADE in their
	// CREATE TABLE statements and therefore must not appear in the old rewrite.
	createdWithCascade := map[string]bool{
		"console_resources": true,
		"user_preferences":  true,
	}
	migrated := map[cascadeFK]string{}
	for _, stmt := range accountDeleteStatements(t, cascadeMigrationFile) {
		m := cascadeStatementPattern.FindStringSubmatch(stmt)
		if m == nil {
			t.Errorf("statement is not a NOT VALID cascade rewrite of a users or revenue_workspaces key: %s", stmt)
			continue
		}
		if m[2] != m[3] {
			t.Errorf("drops %q but adds %q", m[2], m[3])
		}
		if len(m[2]) > 63 {
			t.Errorf("constraint %q exceeds PostgreSQL's 63-byte identifier limit", m[2])
		}
		key := cascadeFK{table: m[1], column: m[4], parent: m[5]}
		if _, dup := migrated[key]; dup {
			t.Errorf("foreign key %v is rewritten twice", key)
		}
		migrated[key] = m[2]
	}

	want := map[cascadeFK]bool{}
	for _, table := range generated.Tables {
		for _, fk := range table.ForeignKeys {
			if fk.RefTable == nil || len(fk.Columns) != 1 {
				continue
			}
			parent := fk.RefTable.Name
			if parent != "users" && parent != "revenue_workspaces" {
				continue
			}
			if fk.OnDelete != entschema.Cascade {
				t.Errorf("Ent schema: %s.%s -> %s is ON DELETE %q, want CASCADE", table.Name, fk.Columns[0].Name, parent, fk.OnDelete)
			}
			if !createdWithCascade[table.Name] {
				want[cascadeFK{table: table.Name, column: fk.Columns[0].Name, parent: parent}] = true
			}
		}
	}
	for key := range want {
		if _, ok := migrated[key]; !ok {
			t.Errorf("the migration does not rewrite %s.%s -> %s", key.table, key.column, key.parent)
		}
	}
	counts := map[string]int{}
	for key := range migrated {
		if !want[key] {
			t.Errorf("the migration rewrites %s.%s -> %s, which the Ent schema does not have", key.table, key.column, key.parent)
		}
		counts[key.parent]++
	}
	if counts["users"] != 67 || counts["revenue_workspaces"] != 36 {
		t.Errorf("rewritten keys = %v, want 67 to users and 36 to revenue_workspaces", counts)
	}
}

func TestAccountDeleteCascadeMigrationValidatesEveryConstraintItAdds(t *testing.T) {
	added := map[[2]string]bool{}
	for _, stmt := range accountDeleteStatements(t, cascadeMigrationFile) {
		if m := cascadeStatementPattern.FindStringSubmatch(stmt); m != nil {
			added[[2]string{m[1], m[2]}] = true
		}
	}
	if len(added) == 0 {
		t.Fatal("the cascade migration adds no constraints")
	}
	validated := map[[2]string]bool{}
	for _, stmt := range accountDeleteStatements(t, validateMigrationFile) {
		m := validateStatementPattern.FindStringSubmatch(stmt)
		if m == nil {
			t.Errorf("unexpected statement in the validate migration: %s", stmt)
			continue
		}
		validated[[2]string{m[1], m[2]}] = true
	}
	for key := range added {
		if !validated[key] {
			t.Errorf("constraint %s on %s is added NOT VALID but never validated", key[1], key[0])
		}
	}
	for key := range validated {
		if !added[key] {
			t.Errorf("the validate migration validates %s on %s, which the cascade migration does not add", key[1], key[0])
		}
	}
}

func TestAccountDeleteCascadeMigrationsKeepValidOrderedNames(t *testing.T) {
	for _, name := range []string{cascadeMigrationFile, validateMigrationFile} {
		if err := validateMigrationName(strings.TrimSuffix(name, ".sql")); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
	if cascadeMigrationFile >= validateMigrationFile {
		t.Error("the validate migration must run after the cascade migration")
	}
}
