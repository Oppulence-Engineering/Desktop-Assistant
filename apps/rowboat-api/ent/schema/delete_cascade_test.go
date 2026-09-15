package schema

import (
	"slices"
	"testing"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema/edge"
)

// TestUserEdgesCascadeOnDelete guards account deletion. DELETE /v1/me removes
// the user row and relies on ON DELETE CASCADE to remove everything the user
// owns. An edge without the annotation makes the delete fail on a foreign key,
// or it leaves personal data behind.
func TestUserEdgesCascadeOnDelete(t *testing.T) {
	assertEdgesCascade(t, User{})
}

// TestRevenueWorkspaceEdgesCascadeOnDelete guards the workspace delete that an
// account deletion performs for a workspace with no other members.
func TestRevenueWorkspaceEdgesCascadeOnDelete(t *testing.T) {
	assertEdgesCascade(t, RevenueWorkspace{})
}

func assertEdgesCascade(t *testing.T, schema ent.Interface) {
	t.Helper()
	if len(schema.Edges()) == 0 {
		t.Fatalf("%s has no edges; the guard would pass vacuously", entTypeName(schema))
	}
	for _, name := range edgesWithoutCascade(schema) {
		t.Errorf("%s edge %q has no entsql.OnDelete(entsql.Cascade) annotation", entTypeName(schema), name)
	}
}

// edgesWithoutCascade returns the owned (edge.To) edges of a schema that do not
// cascade on delete. Inverse edges hold no foreign key, so they are skipped.
func edgesWithoutCascade(schema ent.Interface) []string {
	var missing []string
	for _, e := range schema.Edges() {
		desc := e.Descriptor()
		if desc.Inverse {
			continue
		}
		cascades := false
		for _, a := range desc.Annotations {
			switch ann := a.(type) {
			case *entsql.Annotation:
				cascades = cascades || ann.OnDelete == entsql.Cascade
			case entsql.Annotation:
				cascades = cascades || ann.OnDelete == entsql.Cascade
			}
		}
		if !cascades {
			missing = append(missing, desc.Name)
		}
	}
	return missing
}

// cascadeProbe exercises the guard itself with every annotation shape.
type cascadeProbe struct{ ent.Schema }

func (cascadeProbe) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("pointer_cascade", User.Type).Annotations(entsql.OnDelete(entsql.Cascade)),
		edge.To("value_cascade", User.Type).Annotations(entsql.Annotation{OnDelete: entsql.Cascade}),
		edge.To("no_annotation", User.Type),
		edge.To("set_null", User.Type).Annotations(entsql.OnDelete(entsql.SetNull)),
		edge.To("restrict", User.Type).Annotations(entsql.OnDelete(entsql.Restrict)),
		edge.To("unrelated_annotation", User.Type).Annotations(entsql.Annotation{Table: "elsewhere"}),
		edge.From("inverse", User.Type).Ref("subscription"),
	}
}

func TestCascadeGuardFlagsEveryOwnedEdgeThatDoesNotCascade(t *testing.T) {
	got := edgesWithoutCascade(cascadeProbe{})
	want := []string{"no_annotation", "set_null", "restrict", "unrelated_annotation"}
	if !slices.Equal(got, want) {
		t.Fatalf("edgesWithoutCascade = %v, want %v", got, want)
	}
}

func TestCascadeGuardAcceptsASchemaWhereEveryEdgeCascades(t *testing.T) {
	for _, schema := range []ent.Interface{User{}, RevenueWorkspace{}} {
		if missing := edgesWithoutCascade(schema); len(missing) != 0 {
			t.Errorf("%s: edges without cascade = %v", entTypeName(schema), missing)
		}
	}
}
