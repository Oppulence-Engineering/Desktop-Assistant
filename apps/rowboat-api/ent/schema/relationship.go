package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// Relationship is Rowboat's longitudinal revenue-memory object (RFC 030). It
// stores warm-relationship context and stable external references; the
// enriched commercial lead stays canonical in OutboundConsole and is only
// referenced here, never duplicated.
type Relationship struct{ ent.Schema }

// Mixin of the Relationship.
func (Relationship) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields of the Relationship.
func (Relationship) Fields() []ent.Field {
	return []ent.Field{
		field.String("kind").
			Validate(oneOfRevenue("kind",
				"person", "company", "customer", "opportunity", "referral", "partner")),
		field.String("display_name").NotEmpty(),
		field.String("primary_email").Optional().Sensitive(),
		field.String("account_domain").Optional(),
		field.String("outbound_lead_id").Optional(),
		field.String("outbound_account_ref").Optional(),
		// resource_refs follows RFC 022's product:type:externalId grammar.
		// Deterministic identifiers may propose a link; ambiguous matches
		// require user review and are never merged automatically.
		field.JSON("resource_refs", []string{}).Default([]string{}),
		field.Text("summary").Optional(),
		field.Time("last_touch_at").Optional().Nillable(),
		field.Time("next_action_at").Optional().Nillable(),
		field.String("status").
			Default("active").
			Validate(oneOfRevenue("status", "active", "dormant", "closed", "archived")),
	}
}

// Edges of the Relationship.
func (Relationship) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("relationships").Unique().Required(),
		edge.From("user", User.Type).Ref("relationships").Unique().Required(),
		edge.To("commitments", Commitment.Type).
			StorageKey(edge.Column("relationship_id")),
		edge.To("actions", RevenueAction.Type).
			StorageKey(edge.Column("relationship_id")),
		edge.To("evidences", RevenueEvidence.Type),
	}
}

// Indexes of the Relationship.
func (Relationship) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("primary_email"),
		index.Edges("workspace").Fields("status"),
	}
}
