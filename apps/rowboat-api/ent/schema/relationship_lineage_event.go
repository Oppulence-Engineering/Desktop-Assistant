package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
	"github.com/google/uuid"
)

// RelationshipLineageEvent is the append-only audit trail for identity graph
// decisions and compensating operations.
type RelationshipLineageEvent struct{ ent.Schema }

// Mixin adds the common identifier and audit timestamps.
func (RelationshipLineageEvent) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields defines a compensatable identity-graph transition and its moved refs.
func (RelationshipLineageEvent) Fields() []ent.Field {
	return []ent.Field{
		field.String("kind").Validate(oneOfRevenue("kind", "candidate_created", "deferred", "kept_separate", "merged", "evidence_moved", "split", "undo")),
		field.UUID("actor_id", uuid.UUID{}),
		field.String("reason").Optional().Sensitive(),
		field.JSON("observation_ids", []string{}).Default([]string{}),
		field.JSON("identity_ids", []string{}).Default([]string{}),
		field.JSON("moved_object_refs", []string{}).Default([]string{}),
		field.JSON("before_relationship_ids", []string{}).Default([]string{}),
		field.JSON("after_relationship_ids", []string{}).Default([]string{}),
		field.Time("occurred_at"),
	}
}

// Edges binds lineage to its tenant, reviewed candidate, and acting user.
func (RelationshipLineageEvent) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).Ref("relationship_lineage_events").Unique().Required(),
		edge.From("candidate", RelationshipIdentityCandidate.Type).Ref("lineage_events").Unique().Required(),
		edge.From("user", User.Type).Ref("relationship_lineage_events").Unique().Required(),
	}
}

// Indexes support tenant audit timelines and per-candidate history reads.
func (RelationshipLineageEvent) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("occurred_at"),
		index.Edges("candidate").Fields("created_at"),
	}
}
