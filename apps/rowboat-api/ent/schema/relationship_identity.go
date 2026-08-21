package schema

import (
	"entgo.io/contrib/entoas"
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// RelationshipIdentity is a durable, normalized identity anchor learned from
// email, calendar, Slack, and CRM observations. The unique workspace hash is
// what prevents two canonical relationships from silently claiming the same
// provider record or address; conflicts are held for review rather than merged.
type RelationshipIdentity struct{ ent.Schema }

// Mixin adds the shared immutable ID and timestamp fields.
func (RelationshipIdentity) Mixin() []ent.Mixin { return []ent.Mixin{mixin.WorkspaceTenantMixin{}} }

// Fields defines the normalized identity anchor fields.
func (RelationshipIdentity) Fields() []ent.Field {
	return []ent.Field{
		field.String("kind").Validate(oneOfRevenue("kind", "email", "domain", "resource_ref")),
		field.String("provider").Optional(),
		field.String("key_hash").NotEmpty().Sensitive().Annotations(entoas.Skip(true)),
		field.String("normalized_value").NotEmpty().Sensitive().Annotations(entoas.Skip(true)),
		field.String("source").Optional(),
		field.Float("confidence").Default(1).Min(0).Max(1),
		field.Time("first_seen_at"),
		field.Time("last_seen_at"),
	}
}

// Edges defines the identity's workspace, relationship, and user ownership.
func (RelationshipIdentity) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("relationship_identities").Unique().Required().Immutable(),
		edge.From("relationship", Relationship.Type).
			Ref("identities").Unique().Required(),
		edge.From("user", User.Type).
			Ref("relationship_identities").Unique().Required().Immutable(),
	}
}

// Indexes enforces workspace-wide identity uniqueness and supports kind lookups.
func (RelationshipIdentity) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("key_hash").Unique(),
		index.Edges("relationship").Fields("kind"),
	}
}
