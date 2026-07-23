package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// MailThread is Layer 1 of the tiered cloud mail store (RFC 031): thread-level
// metadata for every scanned thread. It is what the reply-state machine runs
// on — who, when, which direction, how long since — and it holds NO message
// bodies. Bodies live only in the short-TTL MailBodyCache (Layer 3) and quotes
// in RevenueEvidence (Layer 4). Disconnecting Gmail drops this row.
type MailThread struct{ ent.Schema }

// Mixin of the MailThread.
func (MailThread) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields of the MailThread.
func (MailThread) Fields() []ent.Field {
	return []ent.Field{
		field.String("provider").
			Default("gmail").
			Validate(oneOfRevenue("provider", "gmail")),
		field.String("provider_thread_id").NotEmpty(),
		field.String("subject").Optional(),
		// The primary external counterparty of the thread, for joins to a
		// Relationship. Sensitive: an email address is PII.
		field.String("counterparty_email").Optional().Sensitive(),
		field.String("account_domain").Optional(),
		field.JSON("labels", []string{}).Default([]string{}),
		// reply_state is the derived silence signal (Layer 1's whole purpose).
		field.String("reply_state").
			Default("quiet").
			Validate(oneOfRevenue("reply_state", "needs_reply", "awaiting_reply", "quiet")),
		field.String("last_direction").
			Optional().
			Validate(oneOfRevenueOptional("last_direction", "inbound", "outbound")),
		field.Time("last_activity_at").Optional().Nillable(),
		field.Int("message_count").Default(0).Min(0),
		field.Int("outbound_count").Default(0).Min(0),
		field.Int("inbound_count").Default(0).Min(0),
	}
}

// Edges of the MailThread.
func (MailThread) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("mail_threads").Unique().Required(),
		// Resolved link into the revenue graph, when detection matched one.
		edge.From("relationship", Relationship.Type).Ref("mail_threads").Unique(),
		edge.To("messages", MailMessageMeta.Type).
			StorageKey(edge.Column("mail_thread_id")),
	}
}

// Indexes of the MailThread.
func (MailThread) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("user").Fields("provider", "provider_thread_id").Unique(),
		index.Edges("user").Fields("last_activity_at"),
	}
}
