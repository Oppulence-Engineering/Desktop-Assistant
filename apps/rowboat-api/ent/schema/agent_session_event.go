package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// AgentSessionEvent is one durable, seq-ordered lifecycle event for a session
// (RFC 027) — the exact analogue of BackgroundTaskRunEvent. It is the streaming
// source of truth: the NDJSON stream backfills/pages by seq (?afterSeq /
// nextSeq) and no event is lost when no live subscriber is attached. The
// unique (session, seq) index makes the at-least-once append idempotent.
type AgentSessionEvent struct{ ent.Schema }

// Mixin of the AgentSessionEvent.
func (AgentSessionEvent) Mixin() []ent.Mixin { return []ent.Mixin{mixin.UserTenantMixin{}} }

// Fields of the AgentSessionEvent.
func (AgentSessionEvent) Fields() []ent.Field {
	return []ent.Field{
		field.Int("seq").NonNegative(),
		// turn_seq optionally associates the event with a turn (nil for
		// session-level lifecycle events such as created/closed).
		field.Int("turn_seq").Optional().Nillable(),
		field.String("event_type").Optional(),
		field.Text("event_json").NotEmpty().Validate(validJSON),
		field.Time("received_at").Default(mixin.UTCNow).Immutable(),
	}
}

// Edges of the AgentSessionEvent.
func (AgentSessionEvent) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("agent_session_events").Unique().Required().Immutable(),
		edge.From("session", AgentSession.Type).Ref("events").Unique().Required(),
	}
}

// Indexes of the AgentSessionEvent.
func (AgentSessionEvent) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("seq").Edges("session").Unique(),
		index.Fields("event_type"),
	}
}
