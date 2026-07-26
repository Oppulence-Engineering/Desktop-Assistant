package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// RelationshipParticipant is a person and role within a customer account.
// Roles are assertions about this relationship, not global properties of the
// person, so the same email may legitimately have different roles elsewhere.
type RelationshipParticipant struct{ ent.Schema }

func (RelationshipParticipant) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

func (RelationshipParticipant) Fields() []ent.Field {
	return []ent.Field{
		field.String("display_name").NotEmpty(),
		field.String("email").Optional().Sensitive(),
		field.String("role").
			Default("contact").
			Validate(oneOfRevenue("role",
				"contact", "primary_contact", "champion", "decision_maker",
				"blocker", "executive_sponsor", "owner", "former_contact")),
		field.String("title").Optional(),
		field.Bool("active").Default(true),
		field.JSON("external_refs", []string{}).Default([]string{}),
	}
}

func (RelationshipParticipant) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("relationship_participants").Unique().Required(),
		edge.From("relationship", Relationship.Type).
			Ref("participants").Unique().Required(),
		edge.From("user", User.Type).
			Ref("relationship_participants").Unique().Required(),
	}
}

func (RelationshipParticipant) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("relationship").Fields("email"),
		index.Edges("workspace").Fields("email"),
	}
}
