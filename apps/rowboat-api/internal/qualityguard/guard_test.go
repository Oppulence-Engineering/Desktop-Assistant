package qualityguard

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRepositoryGuard(t *testing.T) {
	root := filepath.Clean(filepath.Join("..", ".."))
	violations, err := Check(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, violation := range violations {
		t.Error(violation)
	}
}

func TestTenantRegistryGuardDetectsReadAndWriteDrift(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "ent/schema/widget.go", `package schema
import "entgo.io/ent"
type Widget struct{ ent.Schema }
func (Widget) Edges() []ent.Edge { return []ent.Edge{edge.From("user", User.Type).Unique().Required()} }
`)
	writeFile(t, root, "internal/db/interceptors.go", "package db\n")

	violations, err := checkTenantRegistries(root)
	if err != nil {
		t.Fatal(err)
	}
	assertRules(t, violations, "tenant-read-scope", "tenant-write-scope")
}

func TestTenantRegistryGuardDetectsWorkspaceMixinWithoutUserEdge(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "ent/schema/widget.go", `package schema
import "entgo.io/ent"
type Widget struct{ ent.Schema }
func (Widget) Mixin() []ent.Mixin { return []ent.Mixin{mixin.WorkspaceTenantMixin{}} }
`)
	writeFile(t, root, "internal/db/interceptors.go", "package db\n")

	violations, err := checkTenantRegistries(root)
	if err != nil {
		t.Fatal(err)
	}
	assertRules(t, violations, "tenant-read-scope", "tenant-write-scope")
}

func TestDependencyGuardRejectsInternalToCommandImport(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "internal/example/example.go", `package example
import _ "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/cmd/server"
`)
	violations, err := checkDependencyDirection(root)
	if err != nil {
		t.Fatal(err)
	}
	assertRules(t, violations, "dependency-direction")
}

func writeFile(t *testing.T, root, name, contents string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
}

func assertRules(t *testing.T, violations []Violation, rules ...string) {
	t.Helper()
	joined := make([]string, 0, len(violations))
	for _, violation := range violations {
		joined = append(joined, violation.Rule)
	}
	got := strings.Join(joined, ",")
	for _, rule := range rules {
		if !strings.Contains(got, rule) {
			t.Errorf("missing rule %q in %q", rule, got)
		}
	}
}
