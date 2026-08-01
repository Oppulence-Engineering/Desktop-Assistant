package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// RelationshipAttentionItem is the durable, relationship-native projection
// that tells a user why an account needs attention without conflating triage
// state with execution state.
type RelationshipAttentionItem struct{ ent.Schema }

// Mixin adds the common identifier and audit timestamps.
func (RelationshipAttentionItem) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields defines durable detector output, ranking factors, and review state.
func (RelationshipAttentionItem) Fields() []ent.Field {
	return []ent.Field{
		field.String("stable_key").NotEmpty(),
		field.Int("version").Default(1).Positive(),
		field.String("reason_code").Validate(oneOfRevenue("reason_code",
			"quiet_account", "overdue_commitment", "unresolved_risk", "missing_next_step",
			"source_degradation", "action_outcome_review", "recommendation")),
		field.Text("explanation").NotEmpty(),
		field.String("triggering_object_ref").NotEmpty(),
		field.JSON("evidence_refs", []string{}).Default([]string{}),
		field.String("urgency_band").Validate(oneOfRevenue("urgency_band", "low", "normal", "high", "critical")),
		field.Int("rank_score").Min(0).Max(100),
		field.Text("rank_factors_json").Validate(validJSON),
		field.JSON("source_requirements", []string{}).Default([]string{}),
		field.UUID("recommendation_id", uuid.UUID{}).Optional().Nillable(),
		field.Int("recommendation_revision").Default(0).NonNegative(),
		field.UUID("owner_id", uuid.UUID{}).Optional().Nillable(),
		field.String("status").Default("open").Validate(oneOfRevenue("status",
			"open", "acknowledged", "snoozed", "dismissed", "superseded", "resolved")),
		field.Text("state_reason").Optional(),
		field.Time("snoozed_until").Optional().Nillable(),
		field.Time("expires_at").Optional().Nillable(),
		field.Int("detector_version").Default(1).Positive(),
		field.Int("projector_version").Default(1).Positive(),
		field.Int("relationship_state_version").Default(0).NonNegative(),
		field.String("material_hash").NotEmpty(),
		field.Time("last_detected_at"),
		field.UUID("acknowledged_by", uuid.UUID{}).Optional().Nillable(),
		field.Time("acknowledged_at").Optional().Nillable(),
		field.UUID("dismissed_by", uuid.UUID{}).Optional().Nillable(),
		field.Time("dismissed_at").Optional().Nillable(),
	}
}

// Edges binds each attention item to its tenant, relationship, and creator.
func (RelationshipAttentionItem) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).Ref("relationship_attention_items").Unique().Required(),
		edge.From("relationship", Relationship.Type).Ref("attention_items").Unique().Required(),
		edge.From("user", User.Type).Ref("relationship_attention_items").Unique().Required(),
	}
}

// Indexes enforce stable detector identity and support ordered queue reads.
func (RelationshipAttentionItem) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("stable_key").Unique(),
		index.Edges("workspace").Fields("status", "rank_score"),
		index.Edges("relationship").Fields("status"),
	}
}
