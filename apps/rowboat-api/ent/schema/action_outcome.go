package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// ActionOutcome is one observed result of an executed or reviewed revenue
// action (RFC 030). Outcomes are append-only and idempotent on
// (action, source, source_event_id).
type ActionOutcome struct{ ent.Schema }

// Mixin of the ActionOutcome.
func (ActionOutcome) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields of the ActionOutcome.
func (ActionOutcome) Fields() []ent.Field {
	return []ent.Field{
		field.String("kind").
			Validate(oneOfRevenue("kind",
				"sent", "delivered", "bounced", "replied", "meeting_booked",
				"won", "lost", "dismissed", "bad_recommendation")),
		field.String("source").
			Validate(oneOfRevenue("source", "gmail", "calendar", "crm", "user", "outbound")),
		field.String("source_event_id").NotEmpty(),
		field.Time("occurred_at"),
		field.Text("metadata_json").Optional().Validate(validJSON),
	}
}

// Edges of the ActionOutcome.
func (ActionOutcome) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("outcomes").Unique().Required(),
		edge.From("action", RevenueAction.Type).
			Ref("outcomes").Unique().Required(),
		edge.From("user", User.Type).Ref("action_outcomes").Unique().Required(),
	}
}

// Indexes of the ActionOutcome.
func (ActionOutcome) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("action").Fields("source", "source_event_id").Unique(),
	}
}
