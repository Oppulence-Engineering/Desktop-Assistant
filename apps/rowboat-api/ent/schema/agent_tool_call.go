package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// AgentToolCall is the audit record of one tool invocation inside a turn
// (RFC 027). args_json is the REDACTED arguments (never raw credentials or
// money-moving detail); trust_tier records the RFC 012 tier the registry
// assigned the tool.
type AgentToolCall struct{ ent.Schema }

// Mixin of the AgentToolCall.
func (AgentToolCall) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields of the AgentToolCall.
func (AgentToolCall) Fields() []ent.Field {
	return []ent.Field{
		field.Int("call_index").NonNegative(),
		field.String("tool_name").NotEmpty(),
		field.Text("args_json").Optional().Validate(validJSON),
		field.Int("result_bytes").Default(0).NonNegative(),
		field.String("status").
			Default("pending").
			Validate(oneOfBackgroundTask("status",
				"pending", "running", "completed", "failed", "denied", "awaiting_approval")),
		field.String("error_code").Optional(),
		field.String("trust_tier").Optional(),
		field.Time("started_at").Optional().Nillable(),
		field.Time("completed_at").Optional().Nillable(),
	}
}

// Edges of the AgentToolCall.
func (AgentToolCall) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("agent_tool_calls").Unique().Required(),
		edge.From("turn", AgentTurn.Type).Ref("tool_calls").Unique().Required(),
	}
}

// Indexes of the AgentToolCall.
func (AgentToolCall) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("call_index").Edges("turn").Unique(),
		index.Fields("tool_name"),
	}
}
