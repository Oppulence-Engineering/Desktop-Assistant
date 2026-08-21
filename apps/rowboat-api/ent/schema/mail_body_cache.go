package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// MailBodyCache is Layer 3 of the tiered cloud mail store (RFC 031): the ONLY
// place a message body may live at rest, and only briefly. Bodies are fetched
// on demand (an operator opening the original email), sealed with the column
// encryption key, and given a TTL measured in days. Expired rows are deleted,
// not archived, by a scheduled sweep. Gmail remains the system of record.
type MailBodyCache struct{ ent.Schema }

// Mixin of the MailBodyCache.
func (MailBodyCache) Mixin() []ent.Mixin { return []ent.Mixin{mixin.UserTenantMixin{}} }

// Fields of the MailBodyCache.
func (MailBodyCache) Fields() []ent.Field {
	return []ent.Field{
		field.String("provider").
			Default("gmail").
			Validate(oneOfRevenue("provider", "gmail")),
		field.String("provider_message_id").NotEmpty(),
		// The sealed plain-text body. Sensitive + sealed with crypto.Sealer;
		// never logged or returned raw by ent.
		field.Bytes("sealed_body").Sensitive(),
		field.Time("expires_at"),
	}
}

// Edges of the MailBodyCache.
func (MailBodyCache) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("mail_body_caches").Unique().Required().Immutable(),
	}
}

// Indexes of the MailBodyCache.
func (MailBodyCache) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("user").Fields("provider", "provider_message_id").Unique(),
		index.Fields("expires_at"),
	}
}
