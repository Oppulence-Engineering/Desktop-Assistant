package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// RelationshipSourceStatus exposes connector freshness and repair state
// without turning connector availability into relationship truth.
type RelationshipSourceStatus struct{ ent.Schema }

// Mixin adds the shared base fields to relationship source statuses.
func (RelationshipSourceStatus) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields defines the relationship source status columns.
func (RelationshipSourceStatus) Fields() []ent.Field {
	return []ent.Field{
		field.String("source").NotEmpty(),
		field.String("source_account_id").Default("default"),
		field.String("status").
			Default("connected").
			Validate(oneOfRevenue("status",
				"connected", "syncing", "stale", "error", "disconnected")),
		field.String("cursor").Optional().Sensitive(),
		field.Time("last_success_at").Optional().Nillable(),
		field.Time("last_observation_at").Optional().Nillable(),
		field.Text("last_error").Optional().Sensitive(),
	}
}

// Edges defines the relationship source status graph connections.
func (RelationshipSourceStatus) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("relationship_source_statuses").Unique().Required(),
		edge.From("user", User.Type).
			Ref("relationship_source_statuses").Unique().Required(),
	}
}

// Indexes defines lookup constraints for relationship source statuses.
func (RelationshipSourceStatus) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("source", "source_account_id").Unique(),
	}
}
