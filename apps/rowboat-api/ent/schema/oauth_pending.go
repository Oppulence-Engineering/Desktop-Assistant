package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// OAuthPending is an ephemeral, TTL'd row used by handoff flows: the webapp
// parks an encrypted payload keyed by a state ticket; the desktop redeems it.
// Reading consumes the row.
type OAuthPending struct{ ent.Schema }

// Mixin of the OAuthPending.
func (OAuthPending) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields of the OAuthPending.
func (OAuthPending) Fields() []ent.Field {
	return []ent.Field{
		field.String("state").Unique().NotEmpty(),    // the ticket
		field.String("provider"),                     // google | canvas | corinthian | wispr
		field.Bytes("payload_encrypted").Sensitive(), // AES-GCM-sealed JSON
		field.Time("expires_at"),                     // 10 min TTL
	}
}

// Indexes of the OAuthPending.
func (OAuthPending) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("expires_at"), // sweep expired rows
	}
}
