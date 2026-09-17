package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// CommunicationSyncCursor is the durable per-owner provider watermark claimed
// by incremental Gmail and Calendar workers.
type CommunicationSyncCursor struct{ ent.Schema }

func (CommunicationSyncCursor) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.WorkspaceTenantMixin{}}
}

func (CommunicationSyncCursor) Fields() []ent.Field {
	return []ent.Field{
		field.String("source").Validate(oneOfRevenue("source", "gmail", "calendar")),
		field.String("source_account_id").NotEmpty().Sensitive(),
		field.String("cursor").Optional().Sensitive(),
		field.String("status").
			Default("idle").
			Validate(oneOfRevenue("status", "idle", "queued", "running", "live", "failed")),
		field.Time("last_provider_event_at").Optional().Nillable(),
		field.Time("last_success_at").Optional().Nillable(),
		field.Time("lease_claimed_at").Optional().Nillable(),
		field.Int("retry_count").Default(0).Min(0),
		field.Text("last_error").Optional().Sensitive(),
	}
}

func (CommunicationSyncCursor) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("communication_sync_cursors").Unique().Required().Immutable(),
		edge.From("owner", User.Type).
			Ref("communication_sync_cursors").Unique().Required().Immutable(),
	}
}

func (CommunicationSyncCursor) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace", "owner").Fields("source", "source_account_id").Unique(),
		index.Fields("status", "lease_claimed_at"),
	}
}
