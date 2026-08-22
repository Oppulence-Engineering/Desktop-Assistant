package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// RelationshipAssertion is a provenance-bearing claim consumed by the
// deterministic projector. User corrections outrank source facts, which
// outrank deterministic derivations and AI inferences.
type RelationshipAssertion struct{ ent.Schema }

// Mixin adds the shared base fields to relationship assertions.
func (RelationshipAssertion) Mixin() []ent.Mixin { return []ent.Mixin{mixin.WorkspaceTenantMixin{}} }

// Fields defines the relationship assertion columns.
func (RelationshipAssertion) Fields() []ent.Field {
	return []ent.Field{
		field.String("dimension").
			Validate(oneOfRevenue("dimension",
				"lifecycle", "engagement", "sentiment", "health",
				"summary", "next_action", "risk", "milestone")),
		field.Text("value").NotEmpty().Sensitive(),
		field.String("source_type").
			Validate(oneOfRevenue("source_type",
				"user_correction", "source_fact", "deterministic",
				// See PersonAttribute.source_type: the same ladder tier, kept in
				// step on both tables because assertionPriority reads one switch
				// for both and a tier present on only one of them would rank
				// differently depending on which table it landed in.
				"external_research",
				"ai_inference")),
		field.String("status").
			Default("active").
			Validate(oneOfRevenue("status", "active", "retracted", "superseded")),
		field.Float("confidence").Default(1).Min(0).Max(1),
		field.Text("reason").Optional().Sensitive(),
		field.Time("valid_from"),
		field.Time("valid_to").Optional().Nillable(),
		field.Time("retracted_at").Optional().Nillable(),
		field.Text("retraction_reason").Optional().Sensitive(),
		field.String("supersedes_assertion_id").Optional(),
		field.String("extractor_version").Default("unknown-v1"),
		// JSON array of {title, url, excerpts[]} backing an external_research
		// assertion. See PersonAttribute.citations_json.
		field.Text("citations_json").Optional().Validate(validJSON),
		field.Int("projector_compat_version").Default(1).Positive(),
		field.JSON("supporting_observation_ids", []string{}).Default([]string{}),
	}
}

// Edges defines the relationship assertion graph connections.
func (RelationshipAssertion) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("relationship_assertions").Unique().Required().Immutable(),
		edge.From("relationship", Relationship.Type).
			Ref("assertions").Unique().Required(),
		edge.From("observation", RelationshipObservation.Type).
			Ref("assertions").Unique(),
		edge.From("user", User.Type).
			Ref("relationship_assertions").Unique().Required().Immutable(),
	}
}

// Indexes defines lookup and uniqueness constraints for relationship assertions.
func (RelationshipAssertion) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("relationship").Fields("dimension", "valid_from"),
		index.Edges("relationship").Fields("status", "valid_to"),
	}
}
