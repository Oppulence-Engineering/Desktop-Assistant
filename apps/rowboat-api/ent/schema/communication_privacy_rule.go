package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// CommunicationPrivacyRule is a normalized owner blocklist or protected
// recipient rule. Only keyed hashes are used for matching in logs and audits.
type CommunicationPrivacyRule struct{ ent.Schema }

// Mixin scopes owner privacy rules to their workspace.
func (CommunicationPrivacyRule) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.WorkspaceTenantMixin{}}
}

// Fields defines normalized protected and blocked address rules.
func (CommunicationPrivacyRule) Fields() []ent.Field {
	return []ent.Field{
		field.String("kind").
			Validate(oneOfRevenue("kind", "blocked_address", "blocked_domain", "protected_address", "protected_domain")),
		field.String("value").NotEmpty().Sensitive(),
		field.String("value_hash").NotEmpty(),
		field.Bool("active").Default(true),
	}
}

// Edges binds each rule to its immutable owner and workspace.
func (CommunicationPrivacyRule) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("communication_privacy_rules").Unique().Required().Immutable(),
		edge.From("owner", User.Type).
			Ref("communication_privacy_rules").Unique().Required().Immutable(),
	}
}

// Indexes prevents duplicate rules and supports active-policy reads.
func (CommunicationPrivacyRule) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace", "owner").Fields("kind", "value_hash").Unique(),
		index.Edges("workspace", "owner").Fields("active"),
	}
}
