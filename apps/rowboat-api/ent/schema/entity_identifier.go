package schema

import (
	"entgo.io/contrib/entoas"
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// EntityIdentifier stores only a versioned one-way fingerprint. Unlike a
// resource ref, an identifier can legitimately match multiple entities and is
// therefore indexed, but not workspace-unique, so ambiguity remains reviewable.
type EntityIdentifier struct{ ent.Schema }

func (EntityIdentifier) Mixin() []ent.Mixin { return []ent.Mixin{mixin.WorkspaceTenantMixin{}} }

func (EntityIdentifier) Fields() []ent.Field {
	return []ent.Field{
		field.String("key").NotEmpty().Immutable().Validate(maxRunes("key", 64)),
		field.String("fingerprint").NotEmpty().Immutable().Sensitive().Annotations(entoas.Skip(true)),
	}
}

func (EntityIdentifier) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("entity_identifiers").Unique().Required().Immutable(),
		edge.From("entity", Entity.Type).
			Ref("normalized_identifiers").Unique().Required(),
	}
}

func (EntityIdentifier) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("key", "fingerprint"),
		index.Edges("entity").Fields("key", "fingerprint").Unique(),
	}
}
