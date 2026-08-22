package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// AgentTurn is one message/event submitted into a session (RFC 027) — the
// projection of a single reason→act loop pass. seq is the monotonic turn index
// within the session and anchors the deterministic per-turn ids (turn,
// approval, per-call billing key).
type AgentTurn struct{ ent.Schema }

// Mixin of the AgentTurn.
func (AgentTurn) Mixin() []ent.Mixin { return []ent.Mixin{mixin.UserTenantMixin{}} }

// Fields of the AgentTurn.
func (AgentTurn) Fields() []ent.Field {
	return []ent.Field{
		field.Int("seq").NonNegative(),
		field.Text("input").Optional(),
		field.String("status").
			Default("pending").
			Validate(oneOfBackgroundTask("status", "pending", "running", "completed", "failed", "canceled")),
		field.Text("summary").Optional(),
		field.String("finish_reason").Optional(),
		// Named *_count to avoid colliding with the tool_calls edge.
		field.Int("llm_call_count").Default(0).NonNegative(),
		field.Int("tool_call_count").Default(0).NonNegative(),
		field.Int("cost_units").Default(0).NonNegative(),
		field.Time("started_at").Optional().Nillable(),
		field.Time("completed_at").Optional().Nillable(),
	}
}

// Edges of the AgentTurn.
func (AgentTurn) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("agent_turns").Unique().Required().Immutable(),
		edge.From("session", AgentSession.Type).Ref("turns").Unique().Required(),
		edge.To("tool_calls", AgentToolCall.Type),
	}
}

// Indexes of the AgentTurn.
func (AgentTurn) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("seq").Edges("session").Unique(),
		index.Fields("status"),
	}
}
