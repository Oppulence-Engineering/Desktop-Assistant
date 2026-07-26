package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// RelationshipObservation is immutable normalized evidence emitted by a
// connector or client. Projectors consume observations and their assertions;
// adapters never mutate relationship state directly.
type RelationshipObservation struct{ ent.Schema }

func (RelationshipObservation) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

func (RelationshipObservation) Fields() []ent.Field {
	return []ent.Field{
		field.String("source").
			Validate(oneOfRevenue("source",
				"gmail", "calendar", "slack", "hubspot", "meeting",
				"desktop_note", "voice_note", "browser", "crm", "user")),
		field.String("source_account_id").Optional(),
		field.String("external_id").NotEmpty(),
		field.String("source_version").Default("1"),
		field.String("event_type").NotEmpty(),
		field.Time("occurred_at"),
		field.Time("received_at"),
		field.Text("summary").Optional().Sensitive(),
		field.Text("normalized_facts_json").Default("{}").Sensitive(),
		field.String("content_hash").NotEmpty(),
		field.Bytes("payload_ciphertext").Optional().Sensitive(),
	}
}

func (RelationshipObservation) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("relationship_observations").Unique().Required(),
		edge.From("relationship", Relationship.Type).
			Ref("observations").Unique().Required(),
		edge.From("user", User.Type).
			Ref("relationship_observations").Unique().Required(),
		edge.To("assertions", RelationshipAssertion.Type).
			StorageKey(edge.Column("observation_id")),
	}
}

func (RelationshipObservation) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").
			Fields("source", "external_id", "source_version").
			Unique(),
		index.Edges("relationship").Fields("occurred_at"),
	}
}
