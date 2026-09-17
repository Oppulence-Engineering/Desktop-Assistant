package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// CommunicationInteraction is the workspace-visible, policy-filtered metadata
// projection of one owner-scoped Gmail message or Calendar event. Provider
// content never lives here; bodies and attachment bytes remain behind explicit
// owner authorization.
type CommunicationInteraction struct{ ent.Schema }

// Mixin scopes communication metadata to its workspace.
func (CommunicationInteraction) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.WorkspaceTenantMixin{}}
}

// Fields defines provider identity, redacted metadata, and tombstone state.
func (CommunicationInteraction) Fields() []ent.Field {
	return []ent.Field{
		field.String("source").Validate(oneOfRevenue("source", "gmail", "calendar")),
		field.String("source_account_id").NotEmpty().Sensitive(),
		field.String("provider_object_id").NotEmpty().Sensitive(),
		field.String("source_version").Default("1"),
		field.String("interaction_type").
			Validate(oneOfRevenue("interaction_type", "email", "meeting")),
		field.String("direction").
			Optional().
			Validate(oneOfRevenueOptional("direction", "inbound", "outbound")),
		field.String("subject").Optional().Sensitive(),
		field.Time("occurred_at"),
		field.Time("received_at"),
		field.String("visibility").
			Default("metadata").
			Validate(oneOfRevenue("visibility", "private", "metadata", "full")),
		field.Bool("deleted").Default(false),
		field.String("content_hash").NotEmpty(),
		field.Text("metadata_json").Default("{}").Validate(validJSON).Sensitive(),
	}
}

// Edges preserves immutable ownership while linking sanitized projections.
func (CommunicationInteraction) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("communication_interactions").Unique().Required().Immutable(),
		edge.From("owner", User.Type).
			Ref("owned_communication_interactions").Unique().Required().Immutable(),
		edge.From("relationship", Relationship.Type).
			Ref("communication_interactions").Unique(),
		edge.To("participants", CommunicationParticipant.Type).
			StorageKey(edge.Column("communication_interaction_id")).
			Annotations(entsql.OnDelete(entsql.Cascade)),
		edge.To("attachments", CommunicationAttachment.Type).
			StorageKey(edge.Column("communication_interaction_id")).
			Annotations(entsql.OnDelete(entsql.Cascade)),
	}
}

// Indexes enforces replay-safe provider identity and timeline access paths.
func (CommunicationInteraction) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").
			Fields("source", "source_account_id", "provider_object_id", "source_version").
			Unique(),
		index.Edges("workspace").Fields("occurred_at"),
		index.Edges("relationship").Fields("occurred_at"),
		index.Edges("owner").Fields("occurred_at"),
	}
}
