package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// PersonMergeCandidate holds two persons that an anchor collision says might be the
// same human, for review. Persons are never merged automatically.
//
// It carries its decision inline rather than in a separate decisions + lineage pair
// the way RelationshipIdentityCandidate does, and the asymmetry is deliberate. A
// relationship merge physically re-points observations, assertions, evidence,
// commitments, actions and mail threads across accounts — destructive and hard to
// reverse, so it needs an immutable decision ledger and compensation records. A
// person merge in v1 moves exactly two things, both trivially reversible:
// person_identities.person_id and relationship_participants.person_id. The loser is
// tombstoned rather than deleted, and previous_state_json records the exact moved id
// sets, which is the complete compensation record. If person merges ever move
// evidence, add the ledger then.
type PersonMergeCandidate struct{ ent.Schema }

// Mixin adds the shared immutable ID and timestamp fields.
func (PersonMergeCandidate) Mixin() []ent.Mixin { return []ent.Mixin{mixin.WorkspaceTenantMixin{}} }

// Fields defines the merge candidate columns.
func (PersonMergeCandidate) Fields() []ent.Field {
	return []ent.Field{
		field.String("dedupe_key").NotEmpty(),
		field.String("status").
			Default("pending").
			Validate(oneOfRevenue("status",
				"pending", "deferred", "resolving", "resolved", "undone")),
		field.String("candidate_type").
			Default("anchor_collision").
			Validate(oneOfRevenue("candidate_type",
				"anchor_collision", "multi_match", "manual_review")),
		field.String("anchor_kind").NotEmpty(),
		field.String("anchor_provider").Optional(),
		field.String("anchor_key_hash").NotEmpty().Sensitive(),
		field.String("anchor_preview").Optional().Sensitive(),
		field.JSON("matching_anchors", []string{}).Default([]string{}),
		field.JSON("conflicting_anchors", []string{}).Default([]string{}),
		field.Text("impact_json").Default("{}").Sensitive(),
		field.String("recommended_decision").
			Default("defer").
			Validate(oneOfRevenue("recommended_decision", "merge", "keep_separate", "defer")),
		field.Float("confidence").Default(0).Min(0).Max(1),
		field.Int("version").Default(1).Positive(),
		field.String("decision").
			Optional().
			Validate(oneOfRevenueOptional("decision", "merge", "keep_separate", "defer", "undo")),
		field.Text("decision_reason").Optional().Sensitive(),
		field.UUID("decision_actor_id", uuid.UUID{}).Optional().Nillable(),
		field.Time("decided_at").Optional().Nillable(),
		field.String("idempotency_key").Optional(),
		// The complete compensation record: the exact moved identity and
		// participant ids, so a merge can be undone without guessing.
		field.Text("previous_state_json").Default("{}").Sensitive(),
	}
}

// Edges defines the candidate's workspace, both persons, and user ownership.
func (PersonMergeCandidate) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("person_merge_candidates").Unique().Required().Immutable(),
		edge.From("proposed_person", Person.Type).
			Ref("proposed_merge_candidates").Unique().Required(),
		edge.From("existing_person", Person.Type).
			Ref("existing_merge_candidates").Unique().Required(),
		edge.From("user", User.Type).
			Ref("person_merge_candidates").Unique().Required().Immutable(),
	}
}

// Indexes enforces candidate and decision idempotency.
func (PersonMergeCandidate) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("dedupe_key").Unique(),
		index.Edges("workspace").Fields("status", "created_at"),
	}
}
