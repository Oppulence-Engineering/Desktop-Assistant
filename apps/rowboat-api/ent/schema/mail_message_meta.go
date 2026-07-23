package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// MailMessageMeta is Layer 1 of the tiered cloud mail store (RFC 031): one row
// of per-message metadata. It deliberately has NO body, snippet, or content
// column — the schema guard test asserts this. Detection breadth (who wrote
// whom, when, which direction) comes from here; content depth is fetched on
// demand (Layer 3) and only quotes are kept (Layer 4).
type MailMessageMeta struct{ ent.Schema }

// Mixin of the MailMessageMeta.
func (MailMessageMeta) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields of the MailMessageMeta.
func (MailMessageMeta) Fields() []ent.Field {
	return []ent.Field{
		field.String("provider_message_id").NotEmpty(),
		field.Time("occurred_at"),
		field.String("direction").
			Validate(oneOfRevenue("direction", "inbound", "outbound")),
		field.String("from_addr").Optional().Sensitive(),
		field.String("to_addr").Optional().Sensitive(),
		field.String("subject").Optional(),
		field.JSON("labels", []string{}).Default([]string{}),
	}
}

// Edges of the MailMessageMeta.
func (MailMessageMeta) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("thread", MailThread.Type).Ref("messages").Unique().Required(),
		edge.From("user", User.Type).Ref("mail_message_metas").Unique().Required(),
	}
}

// Indexes of the MailMessageMeta.
func (MailMessageMeta) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("user").Fields("provider_message_id").Unique(),
	}
}
