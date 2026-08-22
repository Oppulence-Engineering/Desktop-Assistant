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

// VoiceSyncItem is an opaque encrypted capture record. No user-authored
// plaintext is stored in this schema.
type VoiceSyncItem struct{ ent.Schema }

// Annotations keeps opaque synchronization records behind their dedicated API.
func (VoiceSyncItem) Annotations() []schema.Annotation {
	return []schema.Annotation{entgql.Annotation{Skip: entgql.SkipAll}}
}

// Mixin scopes every item to its authenticated owner.
func (VoiceSyncItem) Mixin() []ent.Mixin { return []ent.Mixin{mixin.UserTenantMixin{}} }

// Fields defines the versioned encrypted envelope and server-visible metadata.
func (VoiceSyncItem) Fields() []ent.Field {
	return []ent.Field{
		field.String("collection").Validate(oneOfBackgroundTask("collection",
			"note", "folder", "transcription", "dictionary", "snippet", "speaker_profile")),
		field.String("item_id").NotEmpty(),
		field.String("space_id").Optional(),
		field.String("operation").Validate(oneOfBackgroundTask("operation", "upsert", "delete")),
		field.Int("revision").Default(1).Positive(),
		field.String("key_id").NotEmpty(),
		field.String("nonce").NotEmpty().Sensitive(),
		field.Text("ciphertext").NotEmpty().Sensitive(),
		field.String("content_hash").NotEmpty(),
		field.String("blind_index").Optional().Sensitive(),
		field.Time("occurred_at"),
		field.Time("deleted_at").Optional().Nillable(),
	}
}

// Edges assigns the immutable owner.
func (VoiceSyncItem) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("voice_sync_items").Unique().Required().Immutable(),
	}
}

// Indexes enforce one current encrypted item per logical client identity and
// provide the deterministic revision feed used for incremental pulls.
func (VoiceSyncItem) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("user").Fields("collection", "item_id").Unique(),
		index.Edges("user").Fields("updated_at", "id"),
		index.Edges("user").Fields("space_id", "collection", "blind_index"),
	}
}
