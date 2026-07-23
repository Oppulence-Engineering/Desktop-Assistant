package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// MailSignal is Layer 2 of the tiered cloud mail store (RFC 031): derived
// signals for RELEVANT threads only (those detection flagged) — a
// classification, a short summary, and an embedding for semantic recall.
// Embeddings are computed here over bounded derived text, never over the full
// mailbox. Dropped with the thread on disconnect.
type MailSignal struct{ ent.Schema }

// Mixin of the MailSignal.
func (MailSignal) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields of the MailSignal.
func (MailSignal) Fields() []ent.Field {
	return []ent.Field{
		field.String("classification").
			Default("other").
			Validate(oneOfRevenue("classification", "deal", "invoice", "client", "referral", "other")),
		// A short derived summary. Bounded and safe for the UI; not a body.
		field.String("summary").Optional().Sensitive(),
		field.String("embedding_model").Optional(),
		// The embedding vector, little-endian float32 bytes. Marked Sensitive
		// so ent excludes this large binary blob from logging and the admin
		// GraphQL (the house pattern for byte columns); it is purged with the
		// thread on disconnect.
		field.Bytes("embedding").Optional().Sensitive(),
		field.Time("computed_at"),
	}
}

// Edges of the MailSignal.
func (MailSignal) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("thread", MailThread.Type).Ref("signal").Unique().Required(),
		edge.From("user", User.Type).Ref("mail_signals").Unique().Required(),
	}
}

// Indexes of the MailSignal.
func (MailSignal) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("thread").Unique(),
		index.Edges("user").Fields("classification"),
	}
}
