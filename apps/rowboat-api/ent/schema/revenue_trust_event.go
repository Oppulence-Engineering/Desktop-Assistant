package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// RevenueTrustEvent is the content-free activation and trust ledger. Only
// bounded categorical metadata is accepted; raw evidence never enters it.
type RevenueTrustEvent struct{ ent.Schema }

// Mixin adds the common identifier and audit timestamps.
func (RevenueTrustEvent) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields defines bounded, content-free trust and activation dimensions.
func (RevenueTrustEvent) Fields() []ent.Field {
	return []ent.Field{
		field.String("event_name").NotEmpty(),
		field.String("outcome").NotEmpty(),
		field.String("reason_code").Optional(),
		field.String("correlation_id").Optional(),
		field.String("source").Optional(),
		field.String("channel").Optional(),
		field.Int("state_version").Optional().NonNegative(),
		field.Int64("duration_ms").Optional().NonNegative(),
		field.Time("occurred_at"),
	}
}

// Edges bind the event to its tenant and actor plus optional governed objects.
func (RevenueTrustEvent) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).Ref("trust_events").Unique().Required(),
		edge.From("user", User.Type).Ref("revenue_trust_events").Unique().Required(),
		edge.From("relationship", Relationship.Type).Ref("trust_events").Unique(),
		edge.From("action", RevenueAction.Type).Ref("trust_events").Unique(),
	}
}

// Indexes support workspace event-series queries and correlation lookup.
func (RevenueTrustEvent) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("event_name", "occurred_at"),
		index.Fields("correlation_id"),
	}
}
