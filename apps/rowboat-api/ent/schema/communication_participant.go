package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// CommunicationParticipant preserves the participant set used by metadata
// timelines without granting access to the underlying provider content.
type CommunicationParticipant struct{ ent.Schema }

func (CommunicationParticipant) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.WorkspaceTenantMixin{}}
}

func (CommunicationParticipant) Fields() []ent.Field {
	return []ent.Field{
		field.String("email").NotEmpty().Sensitive(),
		field.String("display_name").Optional().Sensitive(),
		field.String("role").
			Validate(oneOfRevenue("role", "from", "to", "cc", "bcc", "organizer", "attendee")),
		field.Bool("external").Default(true),
		field.Bool("owner").Default(false),
	}
}

func (CommunicationParticipant) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("communication_participants").Unique().Required().Immutable(),
		edge.From("interaction", CommunicationInteraction.Type).
			Ref("participants").Unique().Required().Immutable(),
	}
}

func (CommunicationParticipant) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("interaction").Fields("email", "role").Unique(),
		index.Edges("workspace").Fields("email"),
	}
}
