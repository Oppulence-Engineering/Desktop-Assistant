package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// WorkspaceFeatureControl is a per-tenant entitlement or kill switch. Missing
// controls are resolved by the service's explicit compatibility defaults.
type WorkspaceFeatureControl struct{ ent.Schema }

// Mixin adds the common identifier and audit timestamps.
func (WorkspaceFeatureControl) Mixin() []ent.Mixin { return []ent.Mixin{mixin.WorkspaceTenantMixin{}} }

// Fields defines one capability's enablement, rollout stage, and reason.
func (WorkspaceFeatureControl) Fields() []ent.Field {
	return []ent.Field{
		field.String("capability").NotEmpty(),
		field.Bool("enabled").Default(false),
		field.String("rollout_stage").Default("synthetic").
			Validate(oneOfRevenue("rollout_stage", "synthetic", "internal_read_only", "internal_governed_action", "design_partner_read_only", "design_partner_governed_action", "beta")),
		field.String("reason_code").Optional(),
	}
}

// Edges bind the control to its tenant and last managing user.
func (WorkspaceFeatureControl) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).Ref("feature_controls").Unique().Required().Immutable(),
		edge.From("user", User.Type).Ref("workspace_feature_controls").Unique().Required().Immutable(),
	}
}

// Indexes enforce one control row per tenant capability.
func (WorkspaceFeatureControl) Indexes() []ent.Index {
	return []ent.Index{index.Edges("workspace").Fields("capability").Unique()}
}
