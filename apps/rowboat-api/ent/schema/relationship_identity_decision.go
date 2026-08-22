package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
	"github.com/google/uuid"
)

// RelationshipIdentityDecision is the immutable, actor-bound command record
// for an identity review. The candidate stores its current projection; this
// entity preserves every decision and compensation forever.
type RelationshipIdentityDecision struct{ ent.Schema }

// Mixin adds the common identifier and audit timestamps.
func (RelationshipIdentityDecision) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.WorkspaceTenantMixin{}}
}

// Fields defines one version-bound, actor-attributed identity decision.
func (RelationshipIdentityDecision) Fields() []ent.Field {
	return []ent.Field{
		field.String("idempotency_key").NotEmpty(),
		field.String("decision").Validate(oneOfRevenue("decision",
			"merge", "keep_separate", "move_evidence", "split", "defer", "undo")),
		field.Int("candidate_version").Positive(),
		field.UUID("actor_id", uuid.UUID{}),
		field.String("reason").Optional().Sensitive(),
		field.Time("decided_at"),
		field.UUID("compensates_decision_id", uuid.UUID{}).Optional().Nillable(),
	}
}

// Edges binds a decision to its tenant, candidate, and acting user.
func (RelationshipIdentityDecision) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("relationship_identity_decisions").Unique().Required().Immutable(),
		edge.From("candidate", RelationshipIdentityCandidate.Type).
			Ref("decisions").Unique().Required(),
		edge.From("user", User.Type).
			Ref("relationship_identity_decisions").Unique().Required().Immutable(),
	}
}

// Indexes enforce request idempotency and one decision per candidate version.
func (RelationshipIdentityDecision) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("idempotency_key").Unique(),
		index.Edges("candidate").Fields("candidate_version").Unique(),
	}
}
