package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
	"github.com/google/uuid"
)

// ConnectorRevocationJob is the durable credential-revocation outbox. The
// connection tombstone never retains usable credentials.
type ConnectorRevocationJob struct{ ent.Schema }

func (ConnectorRevocationJob) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

func (ConnectorRevocationJob) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("connection_id", uuid.UUID{}),
		field.UUID("owner_id", uuid.UUID{}),
		field.String("connector"),
		field.Bytes("refresh_token_encrypted").Sensitive(),
		field.String("status").Default("pending"),
		field.Int("attempts").Default(0),
		field.Time("next_attempt_at"),
		field.String("last_error").Optional(),
		field.Time("completed_at").Optional(),
	}
}

func (ConnectorRevocationJob) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("connection_id").Unique(),
		index.Fields("status", "next_attempt_at"),
	}
}
