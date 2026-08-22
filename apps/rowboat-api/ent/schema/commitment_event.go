package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// CommitmentEvent is the append-only authority for commitment transitions (RFC 037).
type CommitmentEvent struct{ ent.Schema }

// Mixin adds shared identifiers and timestamps.
func (CommitmentEvent) Mixin() []ent.Mixin { return []ent.Mixin{mixin.WorkspaceTenantMixin{}} }

// Fields defines immutable transition provenance and payload data.
func (CommitmentEvent) Fields() []ent.Field {
	return []ent.Field{
		field.String("source_event_id").NotEmpty(),
		field.Int("version").Positive(),
		field.String("kind").Validate(oneOfRevenue("kind",
			"proposed", "internally_confirmed", "offered", "accepted", "disputed",
			"blocked", "unblocked", "due_date_changed", "renegotiated", "fulfilled",
			"cancelled", "superseded")),
		field.String("actor_type").Validate(oneOfRevenue("actor_type",
			"user", "source_fact", "deterministic_rule", "ai_candidate")),
		field.String("actor_ref").Optional(),
		field.Time("occurred_at"),
		field.String("source_observation_id").Optional(),
		field.JSON("evidence_refs", []string{}).Default([]string{}),
		field.Text("payload_json").Default("{}").Sensitive(),
	}
}

// Edges scopes each event to its tenant, relationship, actor, and commitment.
func (CommitmentEvent) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).Ref("commitment_events").Unique().Required().Immutable(),
		edge.From("relationship", Relationship.Type).Ref("commitment_events").Unique().Required(),
		edge.From("user", User.Type).Ref("commitment_events").Unique().Required().Immutable(),
		edge.From("commitment", Commitment.Type).Ref("events").Unique().Required(),
	}
}

// Indexes enforces one ordered event version per commitment and source-event dedupe.
func (CommitmentEvent) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("commitment").Fields("version").Unique(),
		index.Edges("workspace").Fields("source_event_id").Unique(),
	}
}
