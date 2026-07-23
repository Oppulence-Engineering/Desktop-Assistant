package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// Commitment is a promise extracted from communication (RFC 030). LLM
// extraction creates an unconfirmed commitment; user edits or an explicit
// source statement confirm it. A commitment always carries evidence edges.
type Commitment struct{ ent.Schema }

// Mixin of the Commitment.
func (Commitment) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields of the Commitment.
func (Commitment) Fields() []ent.Field {
	return []ent.Field{
		field.String("direction").
			Validate(oneOfRevenue("direction",
				"promised_by_me", "promised_by_them", "mutual")),
		field.Text("text").NotEmpty().Sensitive(),
		field.String("status").
			Default("open").
			Validate(oneOfRevenue("status", "open", "fulfilled", "cancelled", "superseded")),
		field.Time("due_at").Optional().Nillable(),
		field.Float("confidence").Min(0).Max(1),
		field.Bool("user_confirmed").Default(false),
	}
}

// Edges of the Commitment.
func (Commitment) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("commitments").Unique().Required(),
		edge.From("relationship", Relationship.Type).
			Ref("commitments").Unique().Required(),
		edge.From("user", User.Type).Ref("commitments").Unique().Required(),
		edge.To("evidences", RevenueEvidence.Type),
	}
}
