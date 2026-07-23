package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// RevenueEvidence anchors every recommendation and material claim to a source
// record (RFC 030, storage rules per RFC 031). The excerpt is bounded and safe
// for the approval UI; raw provider content stays sealed in payload_ciphertext
// and never crosses a product boundary by default.
type RevenueEvidence struct{ ent.Schema }

// Mixin of the RevenueEvidence.
func (RevenueEvidence) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields of the RevenueEvidence.
func (RevenueEvidence) Fields() []ent.Field {
	return []ent.Field{
		field.String("source").
			Validate(oneOfRevenue("source",
				"gmail", "calendar", "meeting", "slack", "outbound", "crm")),
		field.String("source_account_id").Optional(),
		field.String("source_record_id").NotEmpty(),
		field.String("source_uri").Optional(),
		field.String("content_hash").NotEmpty(),
		field.Text("excerpt").Optional().Sensitive(),
		field.Bytes("payload_ciphertext").Optional().Sensitive(),
		field.Time("occurred_at"),
		field.Time("observed_at"),
		field.JSON("external_evidence_refs", []string{}).Default([]string{}),
	}
}

// Edges of the RevenueEvidence.
func (RevenueEvidence) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("evidences").Unique().Required(),
		edge.From("user", User.Type).Ref("revenue_evidences").Unique().Required(),
		edge.From("relationships", Relationship.Type).Ref("evidences"),
		edge.From("commitments", Commitment.Type).Ref("evidences"),
		edge.From("actions", RevenueAction.Type).Ref("evidences"),
	}
}

// Indexes of the RevenueEvidence.
func (RevenueEvidence) Indexes() []ent.Index {
	return []ent.Index{
		// Scan reruns dedupe observed records per workspace and source.
		index.Edges("workspace").Fields("source", "source_record_id", "content_hash").Unique(),
	}
}
