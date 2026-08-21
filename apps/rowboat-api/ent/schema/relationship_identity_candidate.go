package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
	"github.com/google/uuid"
)

// RelationshipIdentityCandidate is a durable, fail-closed ambiguity between
// two canonical relationships. Advisory confidence never performs a merge.
type RelationshipIdentityCandidate struct{ ent.Schema }

// Mixin adds the common identifier and audit timestamps.
func (RelationshipIdentityCandidate) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.WorkspaceTenantMixin{}, mixin.OptimisticLockMixin{Field: "version"}}
}

// Fields defines the redacted identity signals, impact, and review decision.
func (RelationshipIdentityCandidate) Fields() []ent.Field {
	return []ent.Field{
		field.String("dedupe_key").NotEmpty(),
		field.String("status").Default("pending").
			Validate(oneOfRevenue("status", "pending", "deferred", "resolving", "resolved", "undone")),
		field.String("candidate_type").Default("anchor_collision").
			Validate(oneOfRevenue("candidate_type", "anchor_collision", "multi_match", "manual_review")),
		field.String("anchor_kind").NotEmpty(),
		field.String("anchor_provider").Optional(),
		field.String("anchor_key_hash").NotEmpty().Sensitive(),
		field.String("anchor_preview").Optional().Sensitive(),
		field.JSON("matching_anchors", []string{}).Default([]string{}),
		field.JSON("conflicting_anchors", []string{}).Default([]string{}),
		field.JSON("evidence_refs", []string{}).Default([]string{}),
		field.Int("evidence_count").Default(0).NonNegative(),
		field.Time("evidence_from").Optional().Nillable(),
		field.Time("evidence_to").Optional().Nillable(),
		field.Text("impact_json").Default("{}").Sensitive(),
		field.String("recommended_decision").Default("defer").
			Validate(oneOfRevenue("recommended_decision", "merge", "keep_separate", "move_evidence", "defer")),
		field.Float("confidence").Default(0).Min(0).Max(1),
		field.Int("version").Default(1).Positive(),
		field.String("decision").Optional().
			Validate(oneOfRevenueOptional("decision", "merge", "keep_separate", "move_evidence", "split", "defer", "undo")),
		field.String("decision_reason").Optional().Sensitive(),
		field.UUID("decision_actor_id", uuid.UUID{}).Optional().Nillable(),
		field.Time("decided_at").Optional().Nillable(),
		field.UUID("undoes_candidate_id", uuid.UUID{}).Optional().Nillable(),
	}
}

// Edges binds both relationship sides and their immutable decision history.
func (RelationshipIdentityCandidate) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).Ref("identity_candidates").Unique().Required().Immutable(),
		edge.From("proposed_relationship", Relationship.Type).Ref("proposed_identity_candidates").Unique().Required(),
		edge.From("existing_relationship", Relationship.Type).Ref("existing_identity_candidates").Unique().Required(),
		edge.From("user", User.Type).Ref("relationship_identity_candidates").Unique().Required().Immutable(),
		edge.To("lineage_events", RelationshipLineageEvent.Type).
			StorageKey(edge.Column("identity_candidate_id")),
		edge.To("decisions", RelationshipIdentityDecision.Type).
			StorageKey(edge.Column("identity_candidate_id")),
	}
}

// Indexes enforce tenant-local deduplication and support pending review scans.
func (RelationshipIdentityCandidate) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("dedupe_key").Unique(),
		index.Edges("workspace").Fields("status", "created_at"),
	}
}
