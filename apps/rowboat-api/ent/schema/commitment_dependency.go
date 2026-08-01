package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// CommitmentDependency is an evidence-backed directed graph edge.
type CommitmentDependency struct{ ent.Schema }

// Mixin adds shared identifiers and timestamps.
func (CommitmentDependency) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields defines dependency semantics and evidence references.
func (CommitmentDependency) Fields() []ent.Field {
	return []ent.Field{
		field.String("kind").Validate(oneOfRevenue("kind", "blocks", "requires", "supersedes")),
		field.JSON("evidence_refs", []string{}).Default([]string{}),
	}
}

// Edges scopes both endpoints to one tenant and relationship.
func (CommitmentDependency) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).Ref("commitment_dependencies").Unique().Required(),
		edge.From("relationship", Relationship.Type).Ref("commitment_dependencies").Unique().Required(),
		edge.From("user", User.Type).Ref("commitment_dependencies").Unique().Required(),
		edge.From("from_commitment", Commitment.Type).Ref("outgoing_dependencies").Unique().Required(),
		edge.From("to_commitment", Commitment.Type).Ref("incoming_dependencies").Unique().Required(),
	}
}

// Indexes rejects duplicate typed edges between the same commitments.
func (CommitmentDependency) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("from_commitment", "to_commitment").Fields("kind").Unique(),
	}
}
