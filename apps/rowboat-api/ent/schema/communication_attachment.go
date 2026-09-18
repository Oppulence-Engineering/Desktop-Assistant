package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// CommunicationAttachment stores provider attachment metadata only. Bytes and
// extracted text use sealed, expiring caches after policy admission.
type CommunicationAttachment struct{ ent.Schema }

// Mixin scopes attachment metadata to its workspace.
func (CommunicationAttachment) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.WorkspaceTenantMixin{}}
}

// Fields defines metadata, scan state, and sealed short-lived derivatives.
func (CommunicationAttachment) Fields() []ent.Field {
	return []ent.Field{
		field.String("provider_attachment_id").NotEmpty().Sensitive(),
		field.String("filename").Optional().Sensitive(),
		field.String("mime_type").Optional(),
		field.Int64("size_bytes").Default(0).NonNegative(),
		field.String("checksum").Optional(),
		field.String("visibility").
			Default("private").
			Validate(oneOfRevenue("visibility", "private", "metadata", "full")),
		field.String("scan_status").
			Default("not_scanned").
			Validate(oneOfRevenue("scan_status", "not_scanned", "pending", "clean", "rejected", "failed")),
		field.Time("scanned_at").Optional().Nillable(),
		field.Time("expires_at").Optional().Nillable(),
		field.Bytes("sealed_content").Optional().Sensitive(),
		field.Text("sealed_extracted_text").Optional().Sensitive(),
	}
}

// Edges binds an attachment to its interaction and workspace.
func (CommunicationAttachment) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("communication_attachments").Unique().Required().Immutable(),
		edge.From("interaction", CommunicationInteraction.Type).
			Ref("attachments").Unique().Required().Immutable(),
	}
}

// Indexes supports provider idempotency and retention sweeps.
func (CommunicationAttachment) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("interaction").Fields("provider_attachment_id").Unique(),
		index.Edges("workspace").Fields("scan_status", "expires_at"),
	}
}
