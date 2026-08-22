package schema

import (
	"entgo.io/contrib/entgql"
	"entgo.io/contrib/entoas"
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// PersonInteractionStat is the per-(person, relationship) interaction rollup.
//
// Scoped to the pair rather than to the person, because "how often do we talk to
// Jane" and "how often do we talk to Jane about the renewal" are different questions
// and only the second one drives account attention. The person-wide totals are
// materialized onto Person by summing these.
//
// Direction is never guessed: an observation whose direction is unknown increments
// interaction_count only, leaving inbound and outbound untouched.
type PersonInteractionStat struct{ ent.Schema }

// Mixin adds the shared immutable ID and timestamp fields.
func (PersonInteractionStat) Mixin() []ent.Mixin { return []ent.Mixin{mixin.WorkspaceTenantMixin{}} }

// Fields defines the interaction rollup columns.
func (PersonInteractionStat) Fields() []ent.Field {
	return []ent.Field{
		field.Time("first_interaction_at"),
		field.Time("last_interaction_at"),
		field.Time("last_inbound_at").Optional().Nillable(),
		field.Time("last_outbound_at").Optional().Nillable(),
		field.Int("interaction_count").Default(0).NonNegative(),
		field.Int("inbound_count").Default(0).NonNegative(),
		field.Int("outbound_count").Default(0).NonNegative(),
		field.Int("meeting_count").Default(0).NonNegative(),
		// channel -> count, e.g. {"email":41,"meeting":6}
		field.JSON("channel_counts", map[string]int{}).
			Default(map[string]int{}).
			Annotations(entgql.Skip(), entoas.Skip(true)),
		// source -> count, so a degraded source's contribution stays auditable
		// against RelationshipSourceStatus.
		field.JSON("source_counts", map[string]int{}).
			Default(map[string]int{}).
			Annotations(entgql.Skip(), entoas.Skip(true)),
		field.String("last_channel").
			Optional().
			Validate(oneOfRevenueOptional("last_channel",
				"email", "meeting", "call", "chat", "note", "crm")),
		field.String("last_direction").
			Optional().
			Validate(oneOfRevenueOptional("last_direction", "inbound", "outbound", "internal")),
	}
}

// Edges defines the rollup's workspace, person, and relationship ownership.
func (PersonInteractionStat) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("person_interaction_stats").Unique().Required().Immutable(),
		edge.From("person", Person.Type).
			Ref("interaction_stats").Unique().Required(),
		edge.From("relationship", Relationship.Type).
			Ref("person_interaction_stats").Unique().Required(),
	}
}

// Indexes enforces one rollup per pair and supports recency ordering.
func (PersonInteractionStat) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("person", "relationship").Unique(),
		index.Edges("relationship").Fields("last_interaction_at"),
	}
}
