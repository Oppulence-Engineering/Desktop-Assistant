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

// VoiceAPIKey stores only a digest and display metadata for an Oppulence Voice
// capability key. The secret is returned once and is never persisted.
type VoiceAPIKey struct{ ent.Schema }

// Annotations keeps control-plane key records out of the relationship GraphQL API.
func (VoiceAPIKey) Annotations() []schema.Annotation {
	return []schema.Annotation{entgql.Annotation{Skip: entgql.SkipAll}}
}

// Mixin makes API keys user-tenant scoped.
func (VoiceAPIKey) Mixin() []ent.Mixin { return []ent.Mixin{mixin.UserTenantMixin{}} }

// Fields defines scoped key metadata.
func (VoiceAPIKey) Fields() []ent.Field {
	return []ent.Field{
		field.String("name").NotEmpty(),
		field.String("key_digest").NotEmpty().Unique().Sensitive(),
		field.String("key_prefix").NotEmpty(),
		field.Strings("scopes").Default([]string{"notes:read"}),
		field.Time("last_used_at").Optional().Nillable(),
		field.Time("expires_at").Optional().Nillable(),
		field.Time("revoked_at").Optional().Nillable(),
	}
}

// Edges assigns the immutable owner.
func (VoiceAPIKey) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("voice_api_keys").Unique().Required().Immutable(),
	}
}

// Indexes supports active-key listing without exposing the digest.
func (VoiceAPIKey) Indexes() []ent.Index {
	return []ent.Index{index.Edges("user").Fields("created_at")}
}
