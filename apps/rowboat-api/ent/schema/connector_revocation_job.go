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

// ConnectorRevocationJob is the durable credential-revocation outbox. The
// connection tombstone never retains usable credentials.
type ConnectorRevocationJob struct{ ent.Schema }

// Annotations keeps encrypted revocation custody and retry state internal.
func (ConnectorRevocationJob) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.Annotation{Skip: entgql.SkipAll},
		entoas.Skip(true),
	}
}

// Mixin attaches common identity and timestamp fields.
func (ConnectorRevocationJob) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields declares durable revocation work and retry state.
func (ConnectorRevocationJob) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("connection_id", uuid.UUID{}),
		field.UUID("owner_id", uuid.UUID{}),
		field.String("connector"),
		field.Bytes("refresh_token_encrypted").Optional().Sensitive(),
		field.Int64("credential_generation").Positive(),
		field.String("terminal_status"),
		field.String("terminal_reason"),
		field.String("terminal_actor"),
		field.String("status").Default("pending"),
		field.Int("attempts").Default(0),
		field.Time("next_attempt_at"),
		field.UUID("claim_id", uuid.UUID{}).Optional(),
		field.Time("claimed_until").Optional(),
		field.String("last_error").Optional(),
		field.Time("completed_at").Optional(),
	}
}

// Indexes enforces one revocation job per connection and supports due-work scans.
func (ConnectorRevocationJob) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("connection_id").Unique(),
		index.Fields("status", "next_attempt_at"),
	}
}
