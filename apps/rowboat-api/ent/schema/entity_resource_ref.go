package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// EntityResourceRef is the normalized reverse index for one external product
// record. Workspace-wide uniqueness prevents two active canonical entities
// from claiming the same product object under concurrent device writes.
type EntityResourceRef struct{ ent.Schema }

// Mixin applies workspace tenant policy and common row metadata.
func (EntityResourceRef) Mixin() []ent.Mixin { return []ent.Mixin{mixin.WorkspaceTenantMixin{}} }

// Fields defines the immutable normalized external resource reference.
func (EntityResourceRef) Fields() []ent.Field {
	return []ent.Field{
		field.String("ref").NotEmpty().Immutable().Validate(maxRunes("ref", 512)),
	}
}

// Edges ties every external reference to one workspace and entity.
func (EntityResourceRef) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("entity_resource_refs").Unique().Required().Immutable(),
		edge.From("user", User.Type).
			Ref("entity_resource_refs").Unique().Required().Immutable(),
		edge.From("entity", Entity.Type).
			Ref("normalized_resource_refs").Unique().Required(),
	}
}

// Indexes enforces workspace-wide external-reference ownership.
func (EntityResourceRef) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("ref").Unique(),
		index.Edges("entity").Fields("ref").Unique(),
	}
}
