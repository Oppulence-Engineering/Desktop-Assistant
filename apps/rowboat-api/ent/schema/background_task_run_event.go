package schema

import (
	"entgo.io/contrib/entgql"
	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// BackgroundTaskRunEvent mirrors one JSONL event from a desktop run log.
type BackgroundTaskRunEvent struct{ ent.Schema }

// Mixin of the BackgroundTaskRunEvent.
func (BackgroundTaskRunEvent) Mixin() []ent.Mixin { return []ent.Mixin{mixin.UserTenantMixin{}} }

// Annotations of the BackgroundTaskRunEvent.
func (BackgroundTaskRunEvent) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.RelayConnection(),
		entgql.QueryField(),
	}
}

// Fields of the BackgroundTaskRunEvent.
func (BackgroundTaskRunEvent) Fields() []ent.Field {
	return []ent.Field{
		field.Int("seq").NonNegative(),
		field.String("event_type").Optional(),
		field.Text("event_json").NotEmpty().Validate(validJSON),
		field.Time("received_at").Default(mixin.UTCNow).Immutable(),
	}
}

// Edges of the BackgroundTaskRunEvent.
func (BackgroundTaskRunEvent) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("background_task_run_events").Unique().Required().Immutable(),
		edge.From("task", BackgroundTask.Type).Ref("run_events").Unique().Required(),
		edge.From("run", BackgroundTaskRun.Type).Ref("events").Unique().Required(),
	}
}

// Indexes of the BackgroundTaskRunEvent.
func (BackgroundTaskRunEvent) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("seq").Edges("run").Unique(),
		index.Fields("event_type"),
	}
}
