package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// ConversationIntelligenceArtifact is the append-only, tenant-scoped record store for
// RFC 037 domain objects whose application schemas are versioned independently from
// the database. Payloads are bounded validated JSON and marked sensitive. New logical
// versions append rows; services never update prior versions.
type ConversationIntelligenceArtifact struct{ ent.Schema }

// Mixin adds shared identifiers and timestamps.
func (ConversationIntelligenceArtifact) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.WorkspaceTenantMixin{}, mixin.OptimisticLockMixin{Field: "version"}}
}

// Fields defines the bounded, versioned artifact envelope.
func (ConversationIntelligenceArtifact) Fields() []ent.Field {
	return []ent.Field{
		field.String("kind").Validate(oneOfRevenue("kind",
			"extraction_run", "claim_candidate", "review_batch", "review_decision",
			"contradiction_case", "recovery_evaluation", "mutual_action_plan",
			"mutual_action_plan_revision", "recommendation_evaluation",
			"conversation_policy", "governance_decision", "deletion_receipt")),
		field.String("stable_id").NotEmpty(),
		field.Int("version").Default(1).Positive(),
		field.String("status").Optional(),
		field.String("subject_ref").Optional(),
		field.Time("effective_at"),
		field.JSON("evidence_refs", []string{}).Default([]string{}),
		field.Text("payload_json").Validate(validJSON).Sensitive(),
		field.String("payload_hash").NotEmpty(),
	}
}

// Edges scopes artifacts to their tenant and optional relationship.
func (ConversationIntelligenceArtifact) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("conversation_intelligence_artifacts").Unique().Required().Immutable(),
		edge.From("user", User.Type).
			Ref("conversation_intelligence_artifacts").Unique().Required().Immutable(),
		edge.From("relationship", Relationship.Type).
			Ref("conversation_intelligence_artifacts").Unique(),
	}
}

// Indexes enforces immutable logical versions and supports current-state reads.
func (ConversationIntelligenceArtifact) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("kind", "stable_id", "version").Unique(),
		index.Edges("relationship").Fields("kind", "status", "effective_at"),
	}
}
