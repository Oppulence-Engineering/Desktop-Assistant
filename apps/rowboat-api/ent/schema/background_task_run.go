package schema

import (
	"entgo.io/contrib/entgql"
	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// BackgroundTaskRun mirrors one desktop or API-worker execution for a
// background task.
type BackgroundTaskRun struct{ ent.Schema }

// Mixin of the BackgroundTaskRun.
func (BackgroundTaskRun) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.UserTenantMixin{}, mixin.OptimisticLockMixin{Field: "revision"}}
}

// Annotations of the BackgroundTaskRun.
func (BackgroundTaskRun) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.RelayConnection(),
		entgql.QueryField(),
	}
}

// Fields of the BackgroundTaskRun.
func (BackgroundTaskRun) Fields() []ent.Field {
	return []ent.Field{
		field.String("run_id").NotEmpty(),
		field.String("trigger").
			Default("manual").
			Validate(oneOfBackgroundTask("trigger", "manual", "cron", "window", "event", "retry")),
		field.String("status").
			Default("running").
			Validate(oneOfBackgroundTask("status", "queued", "running", "succeeded", "failed", "stopped")),
		field.String("executor").
			Default("desktop").
			Validate(oneOfBackgroundTask("executor", "desktop", "api")),
		field.Int("attempt").Default(1).Positive(),
		field.String("model").Optional(),
		field.String("provider").Optional(),
		field.String("use_case").Optional(),
		field.String("sub_use_case").Optional(),
		// previous_run_id orders runs (the prior run for this task); retry_of_run_id
		// records the specific run a retry re-executes. They differ: a retry sets
		// both, a plain rerun sets neither.
		field.String("previous_run_id").Optional(),
		field.String("retry_of_run_id").Optional(),
		field.String("local_run_id").Optional(),
		field.Text("requested_context").Optional(),
		field.Text("summary").Optional(),
		field.Text("error").Optional(),
		// error_code is a stable, granular machine code (see internal/backgroundtasks
		// errorCode taxonomy); error_details carries human-readable specifics.
		field.String("error_code").Optional(),
		field.Text("error_details").Optional(),
		field.String("temporal_workflow_id").Optional(),
		field.String("temporal_run_id").Optional(),
		field.String("temporal_status").Optional(),
		field.Time("temporal_started_at").Optional().Nillable(),
		field.Time("temporal_closed_at").Optional().Nillable(),
		field.Time("cancel_requested_at").Optional().Nillable(),
		field.Int("progress_percent").Optional().Nillable().
			Min(0).
			Max(100),
		field.Text("progress_message").Optional(),
		field.Time("last_heartbeat_at").Optional().Nillable(),
		field.Time("started_at").Optional().Nillable(),
		field.Time("completed_at").Optional().Nillable(),
		// cloud_event_id links an event-triggered run back to the CloudEvent that
		// fired it (RFC 003). Nullable: manual/cron/window/retry runs have none.
		field.UUID("cloud_event_id", uuid.UUID{}).Optional().Nillable(),
		field.Int("revision").Default(1).Positive(),
	}
}

// Edges of the BackgroundTaskRun.
func (BackgroundTaskRun) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("background_task_runs").Unique().Required().Immutable(),
		edge.From("task", BackgroundTask.Type).Ref("runs").Unique().Required(),
		edge.From("cloud_event", CloudEvent.Type).
			Ref("runs").
			Unique().
			Field("cloud_event_id"),
		edge.To("events", BackgroundTaskRunEvent.Type).
			StorageKey(edge.Column("background_task_run_id")),
	}
}

// Indexes of the BackgroundTaskRun.
func (BackgroundTaskRun) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("run_id").Edges("user").Unique(),
		index.Fields("status"),
		index.Fields("executor", "status"),
		index.Fields("temporal_workflow_id"),
	}
}
