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

// ConnectorCredentialRecovery is the independent, encrypted recovery journal
// used when the normal cleanup escrow cannot be created and for initial OAuth
// grants that must survive ambiguous callback/claim commits. Workers may revoke
// the contained credential, but must never mutate MCPConnection.
type ConnectorCredentialRecovery struct{ ent.Schema }

// Annotations keeps credential recovery state behind internal worker APIs.
func (ConnectorCredentialRecovery) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.Annotation{Skip: entgql.SkipAll},
		entoas.Skip(true),
	}
}

// Mixin attaches common identity and timestamp fields.
func (ConnectorCredentialRecovery) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields defines encrypted recovery material, its durable owner, and retry state.
func (ConnectorCredentialRecovery) Fields() []ent.Field {
	return []ent.Field{
		field.String("connector"),
		field.String("owner_kind"),
		field.String("owner_id"),
		field.Bytes("refresh_token_encrypted").Sensitive(),
		field.String("status").Default("pending"),
		field.Int("attempts").Default(0),
		field.Time("next_attempt_at"),
		field.UUID("claim_id", uuid.UUID{}).Optional(),
		field.Time("claimed_until").Optional(),
		field.String("last_error_code").Optional(),
	}
}

// Indexes supports due-work scans and deterministic owner reconciliation.
func (ConnectorCredentialRecovery) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("status", "next_attempt_at"),
		index.Fields("owner_kind", "owner_id"),
	}
}
