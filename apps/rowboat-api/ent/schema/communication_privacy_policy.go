package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// CommunicationPrivacyPolicy records one mailbox owner's workspace sharing
// defaults. Metadata is visible by default; content defaults remain closed.
type CommunicationPrivacyPolicy struct{ ent.Schema }

// Mixin scopes mailbox-owner policy to its workspace.
func (CommunicationPrivacyPolicy) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.WorkspaceTenantMixin{}}
}

// Fields defines fail-closed sharing and extraction defaults.
func (CommunicationPrivacyPolicy) Fields() []ent.Field {
	return []ent.Field{
		field.String("source_account_id").NotEmpty().Sensitive(),
		field.String("metadata_visibility").
			Default("workspace").
			Validate(oneOfRevenue("metadata_visibility", "private", "workspace")),
		field.Bool("share_subject").Default(true),
		field.Bool("share_body").Default(false),
		field.Bool("share_attachments").Default(false),
		field.Bool("signature_enrichment").Default(true),
		field.Bool("model_contact_extraction").Default(true),
		field.Int("retention_days").Default(540).Positive(),
		field.Int("version").Default(1).Positive(),
	}
}

// Edges binds policy to its immutable mailbox owner and workspace.
func (CommunicationPrivacyPolicy) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("communication_privacy_policies").Unique().Required().Immutable(),
		edge.From("owner", User.Type).
			Ref("communication_privacy_policies").Unique().Required().Immutable(),
	}
}

// Indexes allows one policy per owner mailbox in a workspace.
func (CommunicationPrivacyPolicy) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace", "owner").Fields("source_account_id").Unique(),
	}
}
