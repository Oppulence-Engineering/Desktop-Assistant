package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// RevenueWorkspaceMember grants a Rowboat user access to one RevenueWorkspace
// (RFC 030). Matching email domains is never authorization: membership rows are
// created only by the owner or the server-verified link handshake.
type RevenueWorkspaceMember struct{ ent.Schema }

// Mixin of the RevenueWorkspaceMember.
func (RevenueWorkspaceMember) Mixin() []ent.Mixin { return []ent.Mixin{mixin.WorkspaceTenantMixin{}} }

// Fields of the RevenueWorkspaceMember.
func (RevenueWorkspaceMember) Fields() []ent.Field {
	return []ent.Field{
		field.String("role").
			Default("member").
			Validate(oneOfRevenue("role", "owner", "admin", "member", "viewer")),
		field.String("outbound_account_id").Optional(),
		field.String("status").
			Default("active").
			Validate(oneOfRevenue("status", "active", "removed")),
	}
}

// Edges of the RevenueWorkspaceMember.
func (RevenueWorkspaceMember) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("members").Unique().Required().Immutable(),
		edge.From("user", User.Type).Ref("revenue_workspace_members").Unique().Required().Immutable(),
	}
}

// Indexes of the RevenueWorkspaceMember.
func (RevenueWorkspaceMember) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace", "user").Unique(),
	}
}
