package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// RelationshipProjectionJob is the durable projection outbox. Evidence and
// correction writes enqueue a job in the same transaction; leased workers
// project independently so a projector failure cannot erase accepted evidence.
type RelationshipProjectionJob struct{ ent.Schema }

// Mixin adds shared identity and timestamps.
func (RelationshipProjectionJob) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields defines lease, retry, compatibility, and result metadata.
func (RelationshipProjectionJob) Fields() []ent.Field {
	return []ent.Field{
		field.String("idempotency_key").NotEmpty().Unique(),
		field.String("status").
			Default("pending").
			Validate(oneOfRevenue("status", "pending", "running", "completed", "failed", "dead")),
		field.Int("projector_version").Default(1).Positive(),
		field.Time("evaluated_at"),
		field.JSON("trigger_refs", []string{}).Default([]string{}),
		field.Int("attempts").Default(0).NonNegative(),
		field.Time("next_attempt_at").Optional().Nillable(),
		field.String("lease_owner").Optional(),
		field.Time("lease_expires_at").Optional().Nillable(),
		field.Text("last_error").Optional().Sensitive(),
		field.Time("completed_at").Optional().Nillable(),
		field.String("result_state_hash").Optional(),
	}
}

// Edges bind every job to one tenant, actor, and relationship.
func (RelationshipProjectionJob) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("relationship_projection_jobs").Unique().Required(),
		edge.From("relationship", Relationship.Type).
			Ref("projection_jobs").Unique().Required(),
		edge.From("user", User.Type).
			Ref("relationship_projection_jobs").Unique().Required(),
	}
}

// Indexes support due-job leasing and per-relationship diagnostics.
func (RelationshipProjectionJob) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("status", "next_attempt_at", "lease_expires_at"),
		index.Edges("relationship").Fields("status", "created_at"),
	}
}
