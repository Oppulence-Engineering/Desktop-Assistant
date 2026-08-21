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
func (Commitment) Mixin() []ent.Mixin { return []ent.Mixin{mixin.WorkspaceTenantMixin{}} }

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
		field.String("owner_participant_ref").Optional(),
		field.String("counterparty_participant_ref").Optional(),
		field.String("beneficiary_participant_ref").Optional(),
		field.Text("source_phrase").Optional().Sensitive(),
		field.String("due_phrase").Optional(),
		field.String("due_timezone").Optional(),
		field.String("acceptance").Default("candidate").
			Validate(oneOfRevenue("acceptance", "candidate", "internally_confirmed", "offered", "accepted", "disputed")),
		field.Text("blocker").Optional().Sensitive(),
		field.Time("completed_at").Optional().Nillable(),
		field.Int("current_event_version").Default(0).NonNegative(),
	}
}

// Edges of the Commitment.
func (Commitment) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("commitments").Unique().Required().Immutable(),
		edge.From("relationship", Relationship.Type).
			Ref("commitments").Unique().Required(),
		edge.From("user", User.Type).Ref("commitments").Unique().Required().Immutable(),
		edge.To("evidences", RevenueEvidence.Type),
		edge.To("events", CommitmentEvent.Type).
			StorageKey(edge.Column("commitment_id")),
		edge.To("outgoing_dependencies", CommitmentDependency.Type).
			StorageKey(edge.Column("from_commitment_id")),
		edge.To("incoming_dependencies", CommitmentDependency.Type).
			StorageKey(edge.Column("to_commitment_id")),
	}
}
