package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// AgentSession is the queryable projection of one durable agent session
// (RFC 027), the analogue of BackgroundTaskRun. The Temporal event log is the
// live source of truth; this row outlives Temporal's retention window and
// carries the stable temporal_workflow_id that the client's continuation token
// resolves (it survives ContinueAsNew; only temporal_run_id changes).
type AgentSession struct{ ent.Schema }

// Mixin of the AgentSession.
func (AgentSession) Mixin() []ent.Mixin { return []ent.Mixin{mixin.UserTenantMixin{}} }

// Fields of the AgentSession.
func (AgentSession) Fields() []ent.Field {
	return []ent.Field{
		field.String("session_id").NotEmpty(),
		// agent_slug + agent_source capture which agent definition seeded the
		// session (builtin or tenant), recorded at start so the projection is
		// self-describing even after the definition is edited or forked.
		field.String("agent_slug").NotEmpty(),
		field.String("agent_source").Optional(),
		// agent_revision pins the AgentDefinition revision this session started
		// with (RFC 028): editing/rolling back the definition never changes a
		// running session's behavior mid-flight.
		field.Int("agent_revision").Default(0).NonNegative(),
		field.String("status").
			Default("active").
			Validate(oneOfBackgroundTask("status", "active", "paused", "completed", "failed", "canceled")),
		field.String("channel").Default("http"),
		// channel_key threads an external conversation (e.g. a Slack thread) to
		// one session so a channel adapter can find-or-continue (RFC 027 P5).
		field.String("channel_key").Optional(),
		field.Text("title").Optional(),
		field.String("temporal_workflow_id").Optional(),
		field.String("temporal_run_id").Optional(),
		// Cumulative governors carried through ContinueAsNew and mirrored here
		// for cost/limit observability. Named *_count to avoid colliding with the
		// turns edge (ent forbids a field and edge sharing a name).
		field.Int("turn_count").Default(0).NonNegative(),
		field.Int("llm_call_count").Default(0).NonNegative(),
		field.Int("tool_call_count").Default(0).NonNegative(),
		field.Int("cost_units").Default(0).NonNegative(),
		field.Text("error").Optional(),
		field.String("error_code").Optional(),
		field.Time("last_activity_at").Optional().Nillable(),
		field.Time("started_at").Optional().Nillable(),
		field.Time("completed_at").Optional().Nillable(),
		field.Int("revision").Default(1).Positive(),
	}
}

// Edges of the AgentSession.
func (AgentSession) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("agent_sessions").Unique().Required().Immutable(),
		// agent links a session to its tenant AgentDefinition (nullable: builtin
		// sessions resolve their spec from the embedded registry, no row).
		edge.From("agent", AgentDefinition.Type).Ref("sessions").Unique(),
		edge.To("turns", AgentTurn.Type),
		edge.To("events", AgentSessionEvent.Type),
		edge.To("approvals", AgentApproval.Type),
	}
}

// Indexes of the AgentSession.
func (AgentSession) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("session_id").Edges("user").Unique(),
		index.Fields("status"),
		index.Fields("temporal_workflow_id"),
		// Channel adapters find-or-continue a session by (channel, channel_key)
		// within a tenant.
		index.Fields("channel", "channel_key").Edges("user"),
	}
}
