package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// AgentApproval is one human-in-the-loop approval gate (RFC 027 §HITL). When
// the loop selects a tool whose trust tier requires approval (RFC 012
// act/money-moving), the workflow persists this row (pending), emits
// agent.approval_requested, and blocks on workflow.Await — consuming no worker
// slot — until an approveAction Update resolves it. approval_id is the
// deterministic id derived from the session/turn/tool-call index.
type AgentApproval struct{ ent.Schema }

// Mixin of the AgentApproval.
func (AgentApproval) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields of the AgentApproval.
func (AgentApproval) Fields() []ent.Field {
	return []ent.Field{
		field.String("approval_id").NotEmpty(),
		field.Int("turn_seq").NonNegative(),
		field.Int("tool_call_index").Default(0).NonNegative(),
		field.String("tool_name").NotEmpty(),
		field.String("trust_tier").Optional(),
		field.String("status").
			Default("pending").
			Validate(oneOfBackgroundTask("status", "pending", "granted", "denied", "expired")),
		field.Text("args_redacted_json").Optional().Validate(validJSON),
		// approval_token_ref records WHICH money-moving approval token / MFA
		// step-up (RFC 012) authorized the grant — never the token itself.
		field.String("approval_token_ref").Optional(),
		field.String("requested_by").Optional(),
		field.String("resolved_by").Optional(),
		field.Time("requested_at").Default(mixin.UTCNow).Immutable(),
		field.Time("resolved_at").Optional().Nillable(),
		field.Time("expires_at").Optional().Nillable(),
	}
}

// Edges of the AgentApproval.
func (AgentApproval) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("agent_approvals").Unique().Required(),
		edge.From("session", AgentSession.Type).Ref("approvals").Unique().Required(),
	}
}

// Indexes of the AgentApproval.
func (AgentApproval) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("approval_id").Edges("session").Unique(),
		index.Fields("status"),
	}
}
