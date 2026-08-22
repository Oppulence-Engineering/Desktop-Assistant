package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// PolicyDecisionSnapshot is one immutable OutboundConsole preflight result for
// one exact action revision (RFC 030). A new evaluation always creates a new
// snapshot; nothing updates an existing one. Rowboat never composes the
// decision itself: suppression, verification, ownership, and policy rules are
// owned by the facade, and an unavailable facade means no decision (fail
// closed), never a synthesized pass.
type PolicyDecisionSnapshot struct{ ent.Schema }

// Mixin of the PolicyDecisionSnapshot.
func (PolicyDecisionSnapshot) Mixin() []ent.Mixin { return []ent.Mixin{mixin.WorkspaceTenantMixin{}} }

// Fields of the PolicyDecisionSnapshot.
func (PolicyDecisionSnapshot) Fields() []ent.Field {
	return []ent.Field{
		field.Int("action_revision").Positive(),
		field.String("revision_hash").NotEmpty(),
		field.String("status").
			Validate(oneOfRevenue("status", "passed", "review_required", "blocked")),
		field.String("outbound_lead_id").Optional(),
		field.Text("verification_json").Optional().Validate(validJSON),
		field.Text("suppression_json").Optional().Validate(validJSON),
		field.Text("research_json").Optional().Validate(validJSON),
		field.Text("crm_json").Optional().Validate(validJSON),
		field.JSON("reason_codes", []string{}).Default([]string{}),
		field.JSON("evidence_refs", []string{}).Default([]string{}),
		field.Time("evaluated_at"),
		field.Time("expires_at"),
		field.String("response_hash").NotEmpty(),
	}
}

// Edges of the PolicyDecisionSnapshot.
func (PolicyDecisionSnapshot) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("decisions").Unique().Required().Immutable(),
		edge.From("action", RevenueAction.Type).
			Ref("decisions").Unique().Required(),
		edge.From("user", User.Type).Ref("policy_decision_snapshots").Unique().Required().Immutable(),
	}
}
