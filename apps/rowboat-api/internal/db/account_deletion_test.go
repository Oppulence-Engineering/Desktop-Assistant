package db

import (
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
)

// TestWorkspaceAuthoredTablesCoverTenantMaps keeps account deletion in step with
// the tenant maps. A workspace-scoped table with a user column that is missing
// from workspaceAuthoredTables loses shared rows when a member deletes the
// account, or it blocks the delete on a foreign key.
func TestWorkspaceAuthoredTablesCoverTenantMaps(t *testing.T) {
	listed := map[string]workspaceAuthoredTable{}
	for _, table := range workspaceAuthoredTables {
		listed[table.typ] = table
	}
	for typ, workspaceColumn := range workspaceTenantColumns {
		userColumn, hasUser := tenantUserColumns[typ]
		// Membership rows are the user's own; they must cascade, not move.
		if !hasUser || typ == ent.TypeRevenueWorkspaceMember {
			continue
		}
		table, ok := listed[typ]
		if !ok {
			t.Errorf("%s is workspace scoped with a user column but is not in workspaceAuthoredTables", typ)
			continue
		}
		if table.userColumn != userColumn || table.workspaceColumn != workspaceColumn {
			t.Errorf("%s columns = (%s, %s), want (%s, %s)", typ, table.userColumn, table.workspaceColumn, userColumn, workspaceColumn)
		}
	}
	if len(listed) != len(workspaceAuthoredTables) {
		t.Error("workspaceAuthoredTables lists a type twice")
	}
}

func TestRebindUsesNumberedPlaceholdersOnPostgres(t *testing.T) {
	d := &DB{Dialect: "postgres"}
	if got := d.rebind(`a = ? AND b = ?`); got != `a = $1 AND b = $2` {
		t.Fatalf("rebind = %q", got)
	}
	d.Dialect = "sqlite3"
	if got := d.rebind(`a = ?`); got != `a = ?` {
		t.Fatalf("sqlite rebind = %q", got)
	}
}
