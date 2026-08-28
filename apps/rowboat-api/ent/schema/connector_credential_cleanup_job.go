package schema

import (
	"entgo.io/contrib/entgql"
	"entgo.io/contrib/entoas"
	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
	"github.com/google/uuid"
)

// ConnectorCredentialCleanupJob stores only a sealed provider credential that
// was issued by a successful refresh but was not adopted by MCPConnection.
// Processing this entity must never change connection lifecycle state.
type ConnectorCredentialCleanupJob struct{ ent.Schema }

// Annotations keeps the credential cleanup outbox behind internal worker APIs.
func (ConnectorCredentialCleanupJob) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.Annotation{Skip: entgql.SkipAll},
		entoas.Skip(true),
	}
}

// Mixin attaches common identity and timestamp fields.
func (ConnectorCredentialCleanupJob) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields defines sealed cleanup work and retry lease state.
func (ConnectorCredentialCleanupJob) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("connection_id", uuid.UUID{}),
		field.String("connector"),
		field.Int64("expected_credential_generation").Positive(),
		field.Bytes("refresh_token_encrypted").Sensitive(),
		field.String("status").Default("pending"),
		field.Int("attempts").Default(0),
		field.Time("next_attempt_at"),
		field.UUID("claim_id", uuid.UUID{}).Optional(),
		field.Time("claimed_until").Optional(),
		field.String("last_error_code").Optional(),
		field.Time("completed_at").Optional(),
	}
}

// Indexes supports due-work scans and connection-generation diagnostics.
func (ConnectorCredentialCleanupJob) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("status", "next_attempt_at"),
		index.Fields("connection_id", "expected_credential_generation"),
	}
}
