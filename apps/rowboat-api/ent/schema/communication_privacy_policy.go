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

func (CommunicationPrivacyPolicy) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.WorkspaceTenantMixin{}}
}

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

func (CommunicationPrivacyPolicy) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("communication_privacy_policies").Unique().Required().Immutable(),
		edge.From("owner", User.Type).
			Ref("communication_privacy_policies").Unique().Required().Immutable(),
	}
}

func (CommunicationPrivacyPolicy) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace", "owner").Fields("source_account_id").Unique(),
	}
}
