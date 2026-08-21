package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// RevenueLeakScan is one bounded historical scan over the user's connected
// sources (RFC 030 WP3). Gmail is the first source; the scan stores counts,
// errors, and freshness so subsequent runs are incremental and the UI can
// show progress. Detectors are deterministic: no LLM may bypass date,
// reply-presence, or evidence requirements.
type RevenueLeakScan struct{ ent.Schema }

// Mixin of the RevenueLeakScan.
func (RevenueLeakScan) Mixin() []ent.Mixin { return []ent.Mixin{mixin.WorkspaceTenantMixin{}} }

// Fields of the RevenueLeakScan.
func (RevenueLeakScan) Fields() []ent.Field {
	return []ent.Field{
		field.String("status").
			Default("pending").
			Validate(oneOfRevenue("status", "pending", "running", "completed", "failed")),
		// active_claim is set to the workspace UUID while a scan is pending or
		// running and cleared at every terminal transition. Its unique index is
		// the database-enforced cross-replica mutex: two scheduler replicas may
		// race, but only one can own a workspace claim. NULL permits unlimited
		// historical terminal scans without a partial-index portability trap.
		field.String("active_claim").Optional().Nillable(),
		// mode records the workspace mode at scan time: local scans observe
		// only; linked scans can feed preflight downstream.
		field.String("mode").
			Default("local").
			Validate(oneOfRevenue("mode", "local", "linked")),
		field.Int("lookback_days").Default(90).Min(1).Max(365),
		field.Int("threads_seen").Default(0).Min(0),
		field.Int("candidates_seen").Default(0).Min(0),
		field.Int("relationships_created").Default(0).Min(0),
		field.Int("evidences_created").Default(0).Min(0),
		field.Int("actions_created").Default(0).Min(0),
		field.Time("started_at").Optional().Nillable(),
		field.Time("completed_at").Optional().Nillable(),
		field.Text("error").Optional(),
		// source_freshness_at is the newest message timestamp observed, the
		// incremental cursor for the next run.
		field.Time("source_freshness_at").Optional().Nillable(),
	}
}

// Edges of the RevenueLeakScan.
func (RevenueLeakScan) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("scans").Unique().Required().Immutable(),
		edge.From("user", User.Type).Ref("revenue_leak_scans").Unique().Required().Immutable(),
	}
}

// Indexes of the RevenueLeakScan.
func (RevenueLeakScan) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("status"),
		index.Fields("active_claim").Unique().
			Annotations(entsql.IndexWhere("active_claim IS NOT NULL")),
	}
}
