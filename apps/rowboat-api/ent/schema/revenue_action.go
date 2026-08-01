package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// RevenueAction is one queue item in the Revenue Action Queue (RFC 030). State
// is deliberately split into independent dimensions instead of one status:
// queue_status (operator triage), policy_status (preflight), approval_status,
// and execution_status. Every edit creates a RevenueActionRevision, changes
// revision_hash, and invalidates the previous policy and approval state.
type RevenueAction struct{ ent.Schema }

// Mixin of the RevenueAction.
func (RevenueAction) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields of the RevenueAction.
func (RevenueAction) Fields() []ent.Field {
	return []ent.Field{
		field.String("action_type").
			Validate(oneOfRevenue("action_type",
				"warm_follow_up", "proposal_nudge", "referral_reconnect",
				"customer_risk", "meeting_follow_up", "meeting_recap",
				"crm_update", "follow_up_task", "calendar_hold", "commitment_rescue")),
		field.String("channel").
			Validate(oneOfRevenue("channel", "email", "slack", "call", "crm_task",
				"crm", "task", "calendar")),
		// detector records which RFC 030 detector produced the action; the
		// scan's dedupe_key keeps reruns from duplicating queue items.
		field.String("detector").
			Validate(oneOfRevenue("detector",
				"requested_follow_up_due", "unanswered_proposal", "waiting_on_me",
				"dormant_warm_opportunity", "neglected_referral",
				"former_customer_reconnect", "conversation_action_pack",
				"commitment_due", "manual")),
		field.String("dedupe_key").NotEmpty(),
		field.Int("revision").Default(1).Positive(),
		field.String("revision_hash").NotEmpty(),
		field.Text("reason").NotEmpty(),
		field.String("recipient_email").Optional().Sensitive(),
		field.Text("proposed_subject").Optional(),
		field.Text("proposed_message").Optional().Sensitive(),
		field.String("sender_account_ref").Optional(),
		field.UUID("assigned_user_id", uuid.UUID{}).Optional().Nillable(),
		field.Int("priority_score").Min(0).Max(100),
		// Every priority component is stored and shown (explainable ranking).
		field.Text("priority_components_json").Optional().Validate(validJSON),
		field.String("queue_status").
			Default("open").
			Validate(oneOfRevenue("queue_status", "open", "snoozed", "dismissed", "handled")),
		field.String("policy_status").
			Default("pending").
			Validate(oneOfRevenue("policy_status",
				"pending", "passed", "review_required", "blocked", "stale")),
		field.String("approval_status").
			Default("pending").
			Validate(oneOfRevenue("approval_status", "pending", "approved", "rejected")),
		field.String("execution_status").
			Default("pending").
			Validate(oneOfRevenue("execution_status",
				"pending", "requested", "sent", "failed", "ambiguous", "cancelled")),
		field.String("execution_owner").
			Default("rowboat").
			Validate(oneOfRevenue("execution_owner", "rowboat", "outbound")),
		// Approval is bound to {action, revision, revision_hash, decision}.
		field.Int("approved_revision").Optional(),
		field.UUID("approved_decision_id", uuid.UUID{}).Optional().Nillable(),
		field.UUID("approved_by", uuid.UUID{}).Optional().Nillable(),
		field.Time("approved_at").Optional().Nillable(),
		// Execution idempotency derives from {action, revision}; the provider
		// message id is persisted for ambiguous-result reconciliation.
		field.String("execution_idempotency_key").Optional(),
		field.String("execution_mode").
			Default("draft").
			Validate(oneOfRevenue("execution_mode", "draft", "send")),
		field.String("provider_message_id").Optional(),
		field.String("provider_thread_id").Optional(),
		field.Time("executed_at").Optional().Nillable(),
		field.Text("execution_error").Optional(),
		// Ambiguous provider writes are reconciled by a read-only lookup using
		// the idempotency marker. They are never blindly submitted again.
		field.String("reconciliation_status").Optional().
			Validate(oneOfRevenueOptional("reconciliation_status", "pending", "found", "not_found", "error", "manual_review")),
		field.Int("reconciliation_attempts").Default(0).NonNegative(),
		field.Time("reconciliation_checked_at").Optional().Nillable(),
		field.Time("reconciliation_next_at").Optional().Nillable(),
		field.Text("reconciliation_error").Optional(),
		field.String("dismiss_reason").Optional(),
		field.Time("snoozed_until").Optional().Nillable(),
		field.Time("due_at").Optional().Nillable(),
		field.Time("handled_at").Optional().Nillable(),
	}
}

// Edges of the RevenueAction.
func (RevenueAction) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("actions").Unique().Required(),
		edge.From("relationship", Relationship.Type).
			Ref("actions").Unique().Required(),
		edge.From("user", User.Type).Ref("revenue_actions").Unique().Required(),
		edge.To("evidences", RevenueEvidence.Type),
		edge.To("revisions", RevenueActionRevision.Type).
			StorageKey(edge.Column("revenue_action_id")),
		edge.To("decisions", PolicyDecisionSnapshot.Type).
			StorageKey(edge.Column("revenue_action_id")),
		edge.To("outcomes", ActionOutcome.Type).
			StorageKey(edge.Column("revenue_action_id")),
	}
}

// Indexes of the RevenueAction.
func (RevenueAction) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("dedupe_key").Unique(),
		index.Edges("workspace").Fields("queue_status", "priority_score"),
	}
}
