package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"
)

// CreditLedger is an append-only record of credit grants and consumption.
// available_credits = subscription.sanctioned_credits + SUM(ledger.delta).
type CreditLedger struct{ ent.Schema }

// Fields of the CreditLedger.
func (CreditLedger) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New),
		field.Int("delta"), // negative = consumption, positive = grant/refund
		// llm_call | llm_call_reserve | llm_settle | voice_tts | exa_search | grant | refund
		field.String("reason"),
		field.UUID("request_id", uuid.UUID{}), // idempotency anchor
		field.Time("ts").Default(time.Now).Immutable(),
	}
}

// Edges of the CreditLedger.
func (CreditLedger) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("ledger_entries").Unique().Required(),
	}
}

// Indexes of the CreditLedger.
func (CreditLedger) Indexes() []ent.Index {
	return []ent.Index{
		// Idempotency key. NOTE: deviates from the plan's `request_id`-only
		// unique index. A single charge spans multiple ledger phases
		// (reserve → settle/refund) that share one request_id, so uniqueness
		// must be on (request_id, reason): each phase is independently
		// idempotent and retry-safe, while still preventing double-writes.
		index.Fields("request_id", "reason").Unique(),
	}
}
