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

// UserPreference stores the small, typed console preference document that
// follows a user across browser sessions. Device-only state stays client-side.
type UserPreference struct{ ent.Schema }

// Annotations keeps the persistence envelope behind the console DTO API.
func (UserPreference) Annotations() []schema.Annotation {
	return []schema.Annotation{entgql.Annotation{Skip: entgql.SkipAll}}
}

// Mixin applies user tenant privacy, UUID, and timestamp behavior.
func (UserPreference) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.UserTenantMixin{}}
}

// Fields stores canonical JSON after the console service validates every key.
func (UserPreference) Fields() []ent.Field {
	return []ent.Field{
		field.Text("preferences_json").Default("{}").Validate(validJSON),
	}
}

// Edges assigns the immutable owner.
func (UserPreference) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("user_preferences").Unique().Required().Immutable(),
	}
}

// Indexes enforce exactly one preference document per user.
func (UserPreference) Indexes() []ent.Index {
	return []ent.Index{index.Edges("user").Unique()}
}
