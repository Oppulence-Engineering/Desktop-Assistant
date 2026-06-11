package schema

import (
	"encoding/json"
	"fmt"
	"slices"

	"entgo.io/contrib/entgql"
	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// BackgroundTask mirrors a bg-task/task.yaml entry in rowboat-api. Most tasks
// still execute in the desktop, but API-targeted tasks can be dispatched to the
// server-side Temporal worker.
type BackgroundTask struct{ ent.Schema }

// Mixin of the BackgroundTask.
func (BackgroundTask) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Annotations of the BackgroundTask.
func (BackgroundTask) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.RelayConnection(),
		entgql.QueryField(),
	}
}

// Fields of the BackgroundTask.
func (BackgroundTask) Fields() []ent.Field {
	return []ent.Field{
		field.String("slug").NotEmpty(),
		field.String("name").NotEmpty(),
		field.Text("instructions").NotEmpty(),
		field.Bool("active").Default(true),
		field.Text("triggers_json").Optional().Validate(validJSON),
		field.String("model").Optional(),
		field.String("provider").Optional(),
		field.String("execution_target").
			Default("desktop").
			Validate(oneOfBackgroundTask("execution_target", "desktop", "api")),
		field.Time("task_created_at").Optional(),
		field.Time("last_attempt_at").Optional().Nillable(),
		field.String("last_run_id").Optional(),
		field.Time("last_run_at").Optional().Nillable(),
		field.Text("last_run_summary").Optional(),
		field.Text("last_run_error").Optional(),
		// Temporal Schedule sync health for the cron sub-trigger (RFC 005).
		// Server-owned product summary, written only by the schedule syncer and
		// reconciler — user patches cannot set it. Distinct from the
		// BackgroundTaskScheduleState lease entity (RFC 002).
		field.String("schedule_sync_state").
			Default("paused").
			Validate(oneOfBackgroundTask("schedule_sync_state", "current", "syncing", "failed", "paused")),
		field.Text("schedule_sync_error").Optional(),
		field.Time("schedule_synced_at").Optional().Nillable(),
		field.Int("revision").Default(1).Positive(),
	}
}

// Edges of the BackgroundTask.
func (BackgroundTask) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("background_tasks").Unique().Required(),
		edge.To("artifact", BackgroundTaskArtifact.Type).
			StorageKey(edge.Column("background_task_id")).
			Unique(),
		edge.To("runs", BackgroundTaskRun.Type).
			StorageKey(edge.Column("background_task_id")),
		edge.To("run_events", BackgroundTaskRunEvent.Type).
			StorageKey(edge.Column("background_task_id")),
		edge.To("schedule_states", BackgroundTaskScheduleState.Type).
			StorageKey(edge.Column("background_task_id")),
	}
}

// Indexes of the BackgroundTask.
func (BackgroundTask) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("slug").Edges("user").Unique(),
	}
}

func oneOfBackgroundTask(fieldName string, allowed ...string) func(string) error {
	return func(v string) error {
		if slices.Contains(allowed, v) {
			return nil
		}
		return fmt.Errorf("%s must be one of %v, got %q", fieldName, allowed, v)
	}
}

func validJSON(v string) error {
	var raw any
	if err := json.Unmarshal([]byte(v), &raw); err != nil {
		return fmt.Errorf("must be valid JSON: %w", err)
	}
	return nil
}
