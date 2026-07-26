package schema

import (
	"entgo.io/contrib/entgql"
	"entgo.io/contrib/entproto"
	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"github.com/flume/enthistory"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// User is the local mirror of a WorkOS identity. Upserted on first sight of a
// verified token (keyed by workos_user_id).
type User struct{ ent.Schema }

// Mixin of the User.
func (User) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Annotations of the User (GraphQL exposure via entgql). The history table is
// excluded from GraphQL (entgql.Skip) — history is for incident investigation
// via the ent client, not the public API.
func (User) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.RelayConnection(),
		entgql.QueryField(),
		enthistory.Annotations{Annotations: []schema.Annotation{entgql.Skip()}},
		// gRPC: generate a UserService with read-only Get/List methods.
		entproto.Message(),
		entproto.Service(entproto.Methods(entproto.MethodGet | entproto.MethodList)),
	}
}

// Fields of the User.
func (User) Fields() []ent.Field {
	return []ent.Field{
		// Optional: access tokens often omit email (it lives in the ID token /
		// userinfo). We enrich it via WorkOS when available; until then "".
		field.String("email").Optional().
			Annotations(entproto.Field(4)),
		field.String("workos_user_id").Unique().NotEmpty().
			Annotations(entproto.Field(5)), // user_xxx from WorkOS
		field.String("workos_org_id").Optional().
			Annotations(entproto.Field(6)), // B2B workspaces, if enabled
	}
}

// Edges of the User. They are skipped from the protobuf message — the gRPC
// UserService exposes the scalar fields only; related entities aren't proto
// messages.
func (User) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("subscription", Subscription.Type).Unique().Annotations(entproto.Skip()),
		edge.To("ledger_entries", CreditLedger.Type).Annotations(entproto.Skip()),
		edge.To("meeting_minute_usages", MeetingMinuteUsage.Type).Annotations(entproto.Skip()),
		edge.To("llm_usages", LLMUsage.Type).Annotations(entproto.Skip()),
		edge.To("oauth_connections", OAuthConnection.Type).Annotations(entproto.Skip()),
		edge.To("mcp_connections", MCPConnection.Type).Annotations(entproto.Skip()),
		edge.To("background_tasks", BackgroundTask.Type).Annotations(entproto.Skip()),
		edge.To("background_task_artifacts", BackgroundTaskArtifact.Type).Annotations(entproto.Skip()),
		edge.To("background_task_runs", BackgroundTaskRun.Type).Annotations(entproto.Skip()),
		edge.To("background_task_run_events", BackgroundTaskRunEvent.Type).Annotations(entproto.Skip()),
		edge.To("background_task_schedule_states", BackgroundTaskScheduleState.Type).Annotations(entproto.Skip()),
		edge.To("cloud_events", CloudEvent.Type).Annotations(entproto.Skip()),
		edge.To("google_watches", GoogleWatch.Type).Annotations(entproto.Skip()),
		// Durable agent runtime (RFC 027).
		edge.To("agent_definitions", AgentDefinition.Type).Annotations(entproto.Skip()),
		edge.To("agent_sessions", AgentSession.Type).Annotations(entproto.Skip()),
		edge.To("agent_turns", AgentTurn.Type).Annotations(entproto.Skip()),
		edge.To("agent_session_events", AgentSessionEvent.Type).Annotations(entproto.Skip()),
		edge.To("agent_tool_calls", AgentToolCall.Type).Annotations(entproto.Skip()),
		edge.To("agent_approvals", AgentApproval.Type).Annotations(entproto.Skip()),
		edge.To("agent_tool_result_blobs", AgentToolResultBlob.Type).Annotations(entproto.Skip()),
		// Revenue memory and outbound governance (RFC 030).
		edge.To("revenue_workspaces", RevenueWorkspace.Type).Annotations(entproto.Skip()),
		edge.To("revenue_workspace_members", RevenueWorkspaceMember.Type).Annotations(entproto.Skip()),
		edge.To("relationships", Relationship.Type).Annotations(entproto.Skip()),
		edge.To("revenue_evidences", RevenueEvidence.Type).Annotations(entproto.Skip()),
		edge.To("commitments", Commitment.Type).Annotations(entproto.Skip()),
		edge.To("revenue_actions", RevenueAction.Type).Annotations(entproto.Skip()),
		edge.To("revenue_action_revisions", RevenueActionRevision.Type).Annotations(entproto.Skip()),
		edge.To("policy_decision_snapshots", PolicyDecisionSnapshot.Type).Annotations(entproto.Skip()),
		edge.To("action_outcomes", ActionOutcome.Type).Annotations(entproto.Skip()),
		edge.To("revenue_outbox_events", RevenueOutboxEvent.Type).Annotations(entproto.Skip()),
		edge.To("revenue_leak_scans", RevenueLeakScan.Type).Annotations(entproto.Skip()),
		edge.To("mail_threads", MailThread.Type).Annotations(entproto.Skip()),
		edge.To("mail_message_metas", MailMessageMeta.Type).Annotations(entproto.Skip()),
		edge.To("mail_body_caches", MailBodyCache.Type).Annotations(entproto.Skip()),
		edge.To("mail_signals", MailSignal.Type).Annotations(entproto.Skip()),
		// Relationship intelligence state machine (RFC 036).
		edge.To("relationship_participants", RelationshipParticipant.Type).Annotations(entproto.Skip()),
		edge.To("relationship_observations", RelationshipObservation.Type).Annotations(entproto.Skip()),
		edge.To("relationship_assertions", RelationshipAssertion.Type).Annotations(entproto.Skip()),
		edge.To("relationship_state_snapshots", RelationshipStateSnapshot.Type).Annotations(entproto.Skip()),
		edge.To("relationship_source_statuses", RelationshipSourceStatus.Type).Annotations(entproto.Skip()),
		// RFC 023 closed-loop actions.
		edge.To("action_proposals", ActionProposal.Type).Annotations(entproto.Skip()),
		edge.To("approval_tokens", ApprovalToken.Type).Annotations(entproto.Skip()),
	}
}
