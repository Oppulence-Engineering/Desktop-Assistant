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

// BackgroundTaskArtifact mirrors the task-owned bg-tasks/<slug>/index.md body.
type BackgroundTaskArtifact struct{ ent.Schema }

// Mixin of the BackgroundTaskArtifact.
func (BackgroundTaskArtifact) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Annotations of the BackgroundTaskArtifact.
func (BackgroundTaskArtifact) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.RelayConnection(),
		entgql.QueryField(),
	}
}

// Fields of the BackgroundTaskArtifact.
func (BackgroundTaskArtifact) Fields() []ent.Field {
	return []ent.Field{
		field.Text("body").Default(""),
		field.Int("revision").Default(1).Positive(),
		// updated_by_run_id records which run last wrote this artifact (provenance);
		// content_type lets non-markdown artifacts round-trip through the desktop.
		field.String("updated_by_run_id").Optional(),
		field.String("content_type").Default("text/markdown"),
	}
}

// Edges of the BackgroundTaskArtifact.
func (BackgroundTaskArtifact) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("background_task_artifacts").Unique().Required(),
		edge.From("task", BackgroundTask.Type).Ref("artifact").Unique().Required(),
	}
}

// Indexes of the BackgroundTaskArtifact.
func (BackgroundTaskArtifact) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("task").Unique(),
	}
}
