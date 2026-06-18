package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// AgentDefinition is the declarative, multi-tenant composition of a durable
// agent (RFC 027 Layer 2): instructions, model config, the tool allowlist
// (validated by name against the compiled-in Layer-1 capability registry), and
// subagent/channel/connector wiring. Tool *implementations* are always Go
// activities — this row only references them by name. First-party agents ship
// from an embedded convention directory (internal/agentregistry) and are
// resolved as read-only fallbacks; only tenant-owned agents are stored here.
type AgentDefinition struct{ ent.Schema }

// Mixin of the AgentDefinition.
func (AgentDefinition) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields of the AgentDefinition.
func (AgentDefinition) Fields() []ent.Field {
	return []ent.Field{
		field.String("slug").NotEmpty(),
		field.String("name").NotEmpty(),
		field.Text("instructions").Optional(),
		field.String("model").Optional(),
		field.String("provider").Optional(),
		// limits_json holds per-agent overrides of the per-turn/per-session
		// budgets (agentworkflow.SessionLimits); empty → tenant/runtime defaults.
		field.Text("limits_json").Optional().Validate(validJSON),
		// enabled_tools is the deny-by-default allowlist of capability-registry
		// tool names this agent may use; unknown names are rejected at save.
		field.Strings("enabled_tools").Optional(),
		// subagent_refs are the slugs this agent may delegate to (RFC 018).
		field.Strings("subagent_refs").Optional(),
		// channel_bindings / connector_reqs are declarative wiring consumed by
		// the channel adapters (P5) and the consent broker (RFC 012).
		field.Text("channel_bindings").Optional().Validate(validJSON),
		field.Strings("connector_reqs").Optional(),
		field.String("source").
			Default("tenant").
			Validate(oneOfBackgroundTask("source", "builtin", "tenant")),
		// forked_from records the builtin slug a tenant agent was copied from.
		field.String("forked_from").Optional(),
		field.Int("revision").Default(1).Positive(),
	}
}

// Edges of the AgentDefinition.
func (AgentDefinition) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("agent_definitions").Unique().Required(),
		edge.To("sessions", AgentSession.Type),
	}
}

// Indexes of the AgentDefinition.
func (AgentDefinition) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("slug").Edges("user").Unique(),
		index.Fields("source"),
	}
}
