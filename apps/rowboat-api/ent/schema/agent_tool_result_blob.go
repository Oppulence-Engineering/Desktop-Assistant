package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// AgentToolResultBlob is the claim-check store for an oversized tool result
// (RFC 027 Risks: Temporal history growth). When a tool returns more than the
// transcript cap, the full result is spilled here and only a reference + preview
// re-enters the workflow transcript / Temporal history; the model fetches more
// via the tool_result.read capability. Keyed by (session_id, turn_seq,
// call_index) so the deterministic blob ref resolves it.
type AgentToolResultBlob struct{ ent.Schema }

// Mixin of the AgentToolResultBlob.
func (AgentToolResultBlob) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields of the AgentToolResultBlob.
func (AgentToolResultBlob) Fields() []ent.Field {
	return []ent.Field{
		field.String("session_id").NotEmpty(),
		field.Int("turn_seq").NonNegative(),
		field.Int("call_index").NonNegative(),
		field.String("tool_name").Optional(),
		field.Text("content").NotEmpty(),
		field.Int("total_bytes").NonNegative(),
	}
}

// Edges of the AgentToolResultBlob.
func (AgentToolResultBlob) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("agent_tool_result_blobs").Unique().Required(),
	}
}

// Indexes of the AgentToolResultBlob.
func (AgentToolResultBlob) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("session_id", "turn_seq", "call_index"),
	}
}
