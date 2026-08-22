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

// CaptureArtifact is the explicit, consented handoff from Oppulence Voice to
// Rowboat. Unlike VoiceSyncItem, its payload is readable because the user chose
// to submit it for relationship processing.
type CaptureArtifact struct{ ent.Schema }

// Annotations keeps consented source envelopes behind the ingestion API.
func (CaptureArtifact) Annotations() []schema.Annotation {
	return []schema.Annotation{entgql.Annotation{Skip: entgql.SkipAll}}
}

// Mixin makes artifacts user-tenant scoped.
func (CaptureArtifact) Mixin() []ent.Mixin { return []ent.Mixin{mixin.UserTenantMixin{}} }

// Fields defines the immutable source envelope and processing state.
func (CaptureArtifact) Fields() []ent.Field {
	return []ent.Field{
		field.String("event_id").NotEmpty(),
		field.String("artifact_id").NotEmpty(),
		field.String("schema_version").NotEmpty(),
		field.String("kind").Validate(oneOfBackgroundTask("kind", "note", "transcription", "speaker_mapping")),
		field.String("operation").Validate(oneOfBackgroundTask("operation", "upsert", "delete")),
		field.String("source_product").NotEmpty(),
		field.String("consent_basis").Validate(oneOfBackgroundTask("consent_basis", "user_opt_in")),
		field.String("content_hash").NotEmpty(),
		field.Text("payload_json").NotEmpty().Validate(validJSON).Sensitive(),
		field.String("status").Default("accepted").Validate(oneOfBackgroundTask("status", "accepted", "deleted")),
		field.Time("occurred_at"),
	}
}

// Edges assigns the immutable owner.
func (CaptureArtifact) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("capture_artifacts").Unique().Required().Immutable(),
	}
}

// Indexes make event delivery idempotent and retain the latest logical history.
func (CaptureArtifact) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("user").Fields("event_id").Unique(),
		index.Edges("user").Fields("artifact_id", "created_at"),
	}
}
