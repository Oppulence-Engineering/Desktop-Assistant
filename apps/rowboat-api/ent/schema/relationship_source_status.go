package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// RelationshipSourceStatus exposes connector freshness and repair state
// without turning connector availability into relationship truth.
type RelationshipSourceStatus struct{ ent.Schema }

// Mixin adds the shared base fields to relationship source statuses.
func (RelationshipSourceStatus) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields defines the relationship source status columns.
func (RelationshipSourceStatus) Fields() []ent.Field {
	return []ent.Field{
		field.String("source").NotEmpty(),
		field.String("source_account_id").Default("default"),
		field.UUID("consenting_actor_id", uuid.UUID{}).Optional().Nillable(),
		field.String("status").
			Default("not_connected").
			Validate(oneOfRevenue("status",
				"not_connected", "authorizing", "connected", "backfilling", "live", "degraded", "stale", "rebuilding", "reconnect_required", "disconnected")),
		field.String("backfill_phase").Default("idle").
			Validate(oneOfRevenue("backfill_phase", "idle", "queued", "running", "live", "paused", "failed")),
		field.Int("backfill_completed").Default(0).NonNegative(),
		field.Int("backfill_total").Default(0).NonNegative(),
		field.String("watermark").Optional().Sensitive(),
		field.Time("sync_started_at").Optional().Nillable(),
		field.Time("authorization_started_at").Optional().Nillable(),
		field.Time("authorized_at").Optional().Nillable(),
		field.Time("backfill_completed_at").Optional().Nillable(),
		field.Time("last_failed_sync_at").Optional().Nillable(),
		field.Time("disconnected_at").Optional().Nillable(),
		field.Time("revoked_at").Optional().Nillable(),
		field.Time("last_sync_at").Optional().Nillable(),
		field.Int64("expected_cadence_seconds").Default(900).Positive(),
		field.Int64("lag_seconds").Default(0).NonNegative(),
		field.JSON("required_scopes", []string{}).Default([]string{}),
		field.JSON("granted_scopes", []string{}).Default([]string{}),
		field.JSON("missing_scopes", []string{}).Default([]string{}),
		field.String("error_code").Optional(),
		field.Int("retry_count").Default(0).NonNegative(),
		field.Time("next_retry_at").Optional().Nillable(),
		field.String("completeness").Default("partial").
			Validate(oneOfRevenue("completeness", "complete", "partial", "stale", "rebuilding", "disconnected")),
		field.String("cursor").Optional().Sensitive(),
		field.Time("last_success_at").Optional().Nillable(),
		field.Time("last_observation_at").Optional().Nillable(),
		field.Time("last_provider_event_at").Optional().Nillable(),
		field.Text("last_error").Optional().Sensitive(),
	}
}

// Edges defines the relationship source status graph connections.
func (RelationshipSourceStatus) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("relationship_source_statuses").Unique().Required(),
		edge.From("user", User.Type).
			Ref("relationship_source_statuses").Unique().Required(),
	}
}

// Indexes defines lookup constraints for relationship source statuses.
func (RelationshipSourceStatus) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("source", "source_account_id").Unique(),
	}
}
