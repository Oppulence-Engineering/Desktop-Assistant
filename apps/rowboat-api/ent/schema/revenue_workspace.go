package schema

import (
	"fmt"
	"slices"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// oneOfRevenue validates that a revenue-domain enum field holds one of the
// allowed values. Shared by every RFC 030 schema in this package.
func oneOfRevenue(name string, allowed ...string) func(string) error {
	return func(v string) error {
		if slices.Contains(allowed, v) {
			return nil
		}
		return fmt.Errorf("%s must be one of %v, got %q", name, allowed, v)
	}
}

// oneOfRevenueOptional is oneOfRevenue that also accepts the empty string, for
// Optional enum fields that may be unset.
func oneOfRevenueOptional(name string, allowed ...string) func(string) error {
	inner := oneOfRevenue(name, allowed...)
	return func(v string) error {
		if v == "" {
			return nil
		}
		return inner(v)
	}
}

// RevenueWorkspace maps a Rowboat tenant onto the canonical OutboundConsole
// commercial workspace (RFC 030). Rowboat stores a mapping, never a second
// commercial workspace model. A workspace in "local" mode has no OutboundConsole
// link yet: observation and draft-only execution work, while preflight,
// approval of sends, and outcome reporting stay disabled (fail closed).
type RevenueWorkspace struct{ ent.Schema }

// Mixin of the RevenueWorkspace.
func (RevenueWorkspace) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields of the RevenueWorkspace.
func (RevenueWorkspace) Fields() []ent.Field {
	return []ent.Field{
		field.String("workos_org_id").Optional(),
		field.String("outbound_organization_id").Optional(),
		field.String("outbound_workspace_id").Optional().Nillable().Unique(),
		field.String("mode").
			Default("local").
			Validate(oneOfRevenue("mode", "local", "linked")),
		field.String("status").
			Default("active").
			Validate(oneOfRevenue("status", "active", "disconnected", "repair_required")),
		field.Time("last_verified_at").Optional().Nillable(),
		// When the last proactive digest email was sent, so the scheduled
		// sender can honor a per-user minimum interval.
		field.Time("last_digest_at").Optional().Nillable(),
	}
}

// Edges of the RevenueWorkspace.
func (RevenueWorkspace) Edges() []ent.Edge {
	return []ent.Edge{
		// The founding owner. MVP tenancy is founder-mode: every revenue row is
		// user-scoped through the existing interceptor/hook machinery, with the
		// workspace edge in place for the WP6 member-scoped upgrade.
		edge.From("user", User.Type).Ref("revenue_workspaces").Unique().Required(),
		edge.To("members", RevenueWorkspaceMember.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("relationships", Relationship.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("evidences", RevenueEvidence.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("commitments", Commitment.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("actions", RevenueAction.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("decisions", PolicyDecisionSnapshot.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("outcomes", ActionOutcome.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("outbox_events", RevenueOutboxEvent.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("scans", RevenueLeakScan.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
	}
}

// Indexes of the RevenueWorkspace.
func (RevenueWorkspace) Indexes() []ent.Index {
	return []ent.Index{
		// One workspace per owner (founder-mode tenancy). This makes
		// CurrentWorkspace's get-or-create race-safe: a concurrent first
		// touch loses on the unique constraint and falls back to the winner's
		// row instead of silently splitting the tenant into two workspaces.
		index.Edges("user").Unique(),
	}
}
