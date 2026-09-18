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

// ConsoleResource stores user-authored console artifacts inside one workspace.
// The service owns kind-specific payload validation; the database owns durable
// identity and uniqueness.
type ConsoleResource struct{ ent.Schema }

// Annotations keeps payload documents behind explicit response DTOs.
func (ConsoleResource) Annotations() []schema.Annotation {
	return []schema.Annotation{entgql.Annotation{Skip: entgql.SkipAll}}
}

// Mixin applies workspace tenant privacy, UUID, and timestamp behavior.
func (ConsoleResource) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.WorkspaceTenantMixin{}}
}

// Fields defines the three supported resource kinds. name_key and note_id are
// nullable so one composite uniqueness rule does not collide with another.
func (ConsoleResource) Fields() []ent.Field {
	return []ent.Field{
		field.String("kind").Validate(oneOfRevenue(
			"kind",
			"note_template",
			"note_favorite",
			"graph_saved_view",
		)),
		field.String("name").Optional(),
		field.String("name_key").Optional().Nillable(),
		field.String("note_id").Optional().Nillable(),
		field.Text("payload_json").NotEmpty().Validate(validJSON).Sensitive(),
		field.Int("sort_order").Default(0),
	}
}

// Edges bind the resource to both the workspace and its immutable author.
func (ConsoleResource) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).Ref("console_resources").Unique().Required().Immutable(),
		edge.From("user", User.Type).Ref("console_resources").Unique().Required().Immutable(),
	}
}

// Indexes make names unique per kind and favorite creation idempotent. NULL
// values remain non-conflicting in both PostgreSQL and SQLite.
func (ConsoleResource) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("kind", "name_key").Edges("workspace", "user").Unique(),
		index.Fields("kind", "note_id").Edges("workspace", "user").Unique(),
		index.Fields("kind", "sort_order", "created_at").Edges("workspace", "user"),
	}
}
