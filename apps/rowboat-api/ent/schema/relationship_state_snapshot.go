package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// RelationshipStateSnapshot is an immutable projection checkpoint used by
// both clients for "what changed?" and deterministic replay verification.
type RelationshipStateSnapshot struct{ ent.Schema }

// Mixin adds the shared base fields to relationship state snapshots.
func (RelationshipStateSnapshot) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.WorkspaceTenantMixin{}}
}

// Fields defines the relationship state snapshot columns.
func (RelationshipStateSnapshot) Fields() []ent.Field {
	return []ent.Field{
		field.Int("version").Positive(),
		field.Text("state_json").Default("{}").Sensitive(),
		field.String("state_hash").NotEmpty(),
		field.Int("projector_version").Default(1).Positive(),
		field.Time("evaluated_at"),
		field.JSON("changed_dimensions", []string{}).Default([]string{}),
		field.JSON("assertion_ids", []string{}).Default([]string{}),
	}
}

// Edges defines the relationship state snapshot graph connections.
func (RelationshipStateSnapshot) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("relationship_state_snapshots").Unique().Required().Immutable(),
		edge.From("relationship", Relationship.Type).
			Ref("snapshots").Unique().Required(),
		edge.From("user", User.Type).
			Ref("relationship_state_snapshots").Unique().Required().Immutable(),
	}
}

// Indexes defines lookup and version constraints for relationship state snapshots.
func (RelationshipStateSnapshot) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("relationship").Fields("version").Unique(),
	}
}
