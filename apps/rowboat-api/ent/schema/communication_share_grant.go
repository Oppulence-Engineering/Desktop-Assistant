package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// CommunicationShareGrant is an auditable mailbox-owner decision to reveal
// body or attachment content for one bounded resource.
type CommunicationShareGrant struct{ ent.Schema }

// Mixin scopes explicit grants to their workspace.
func (CommunicationShareGrant) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.WorkspaceTenantMixin{}}
}

// Fields defines bounded content scope, target, expiry, and revocation.
func (CommunicationShareGrant) Fields() []ent.Field {
	return []ent.Field{
		field.String("scope").
			Validate(oneOfRevenue("scope", "body", "attachments", "full")),
		field.String("resource_type").
			Validate(oneOfRevenue("resource_type", "message", "thread", "relationship")),
		field.String("resource_id").NotEmpty().Sensitive(),
		field.Time("expires_at").Optional().Nillable(),
		field.Time("revoked_at").Optional().Nillable(),
		field.String("reason").Optional().Sensitive(),
	}
}

// Edges binds a grant to its owner, optional grantee, and workspace.
func (CommunicationShareGrant) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("communication_share_grants").Unique().Required().Immutable(),
		edge.From("owner", User.Type).
			Ref("owned_communication_share_grants").Unique().Required().Immutable(),
		edge.From("grantee", User.Type).
			Ref("received_communication_share_grants").Unique(),
	}
}

// Indexes prevents duplicate grants and supports active-grant evaluation.
func (CommunicationShareGrant) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace", "owner", "grantee").
			Fields("scope", "resource_type", "resource_id").
			Unique(),
		index.Edges("workspace", "owner").Fields("revoked_at", "expires_at"),
	}
}
