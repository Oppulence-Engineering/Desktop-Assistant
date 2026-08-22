package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// RevenueOutboxEvent is one row of the transactional outbox for cross-product
// revenue integration events (RFC 030). Rows are written in the same
// transaction as the local state change and delivered asynchronously with
// bounded retries. Payloads carry the bounded event envelope only — never raw
// email bodies, proposed messages, tokens, or provider payloads.
type RevenueOutboxEvent struct{ ent.Schema }

// Mixin of the RevenueOutboxEvent.
func (RevenueOutboxEvent) Mixin() []ent.Mixin { return []ent.Mixin{mixin.WorkspaceTenantMixin{}} }

// Fields of the RevenueOutboxEvent.
func (RevenueOutboxEvent) Fields() []ent.Field {
	return []ent.Field{
		field.String("event_type").NotEmpty(),
		field.Int("schema_version").Default(1).Positive(),
		field.UUID("action_id", uuid.UUID{}).Optional().Nillable(),
		field.String("correlation_id").Optional(),
		field.String("causation_id").Optional(),
		field.String("idempotency_key").NotEmpty().Unique(),
		field.Text("payload_json").Optional().Validate(validJSON),
		field.Time("occurred_at"),
		field.String("delivery_status").
			Default("pending").
			Validate(oneOfRevenue("delivery_status", "pending", "delivered", "failed", "dead")),
		field.Int("attempts").Default(0).Min(0),
		field.Time("next_attempt_at").Optional().Nillable(),
		field.Text("last_error").Optional(),
	}
}

// Edges of the RevenueOutboxEvent.
func (RevenueOutboxEvent) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("outbox_events").Unique().Required().Immutable(),
		edge.From("user", User.Type).Ref("revenue_outbox_events").Unique().Required().Immutable(),
	}
}

// Indexes of the RevenueOutboxEvent.
func (RevenueOutboxEvent) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("delivery_status", "next_attempt_at").
			Annotations(entsql.IndexWhere("delivery_status IN ('pending', 'failed')")),
	}
}
