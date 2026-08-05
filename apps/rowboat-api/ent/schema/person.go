package schema

import (
	"entgo.io/contrib/entoas"
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// Person is the workspace-canonical human.
//
// It is NOT a Relationship: a kind="person" Relationship is an *account* whose
// counterparty happens to be an individual; this is the individual themselves, who
// may participate in many accounts. Role and title deliberately stay on
// RelationshipParticipant, because they are assertions about one relationship —
// the same person can be a champion on a renewal and a blocker on an expansion,
// and there is no correct single value.
//
// Every enrichable field here is MATERIALIZED, not authored: it is projected from
// PersonAttribute rows exactly the way Relationship's state dimensions are projected
// from RelationshipAssertion rows. Writing these columns from anywhere except the
// person projector is a bug.
type Person struct{ ent.Schema }

// Mixin adds the shared immutable ID and timestamp fields.
func (Person) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Annotations pins the table name. ent's inflector pluralizes "person" to "people",
// which would break the relationship_* naming family and silently diverge from the
// handwritten migration.
func (Person) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "relationship_persons"}}
}

// Fields defines the projected person columns.
func (Person) Fields() []ent.Field {
	return []ent.Field{
		// --- projected enrichment: written only by projectPersonAttributes ---
		field.String("display_name").NotEmpty(),
		field.JSON("aliases", []string{}).Default([]string{}),
		field.String("primary_email").Optional().Sensitive().Annotations(entoas.Skip(true)),
		field.String("title").Optional(),
		field.String("org_name").Optional(),
		field.String("org_domain").Optional(),
		field.String("phone").Optional().Sensitive().Annotations(entoas.Skip(true)),
		field.String("timezone").Optional(),
		field.String("locale").Optional(),

		// --- projection bookkeeping ---
		field.Int("attributes_version").Default(0).NonNegative(),
		field.String("attributes_hash").Optional(),
		field.Int("projector_version").Default(1).Positive(),
		field.Time("projected_at").Optional().Nillable(),

		// --- lifecycle. A merge tombstones the loser; nothing is deleted. ---
		field.String("status").
			Default("active").
			Validate(oneOfRevenue("status", "active", "merged", "archived")),
		field.UUID("merged_into_person_id", uuid.UUID{}).Optional().Nillable(),
		field.Time("merged_at").Optional().Nillable(),

		// --- rolled-up interaction facts, summed across relationships ---
		field.Time("first_interaction_at").Optional().Nillable(),
		field.Time("last_interaction_at").Optional().Nillable(),
		field.Int("relationship_count").Default(0).NonNegative(),
	}
}

// Edges defines the person's ownership and derived records.
func (Person) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("relationship_persons").Unique().Required(),
		edge.From("user", User.Type).
			Ref("relationship_persons").Unique().Required(),
		edge.To("identities", PersonIdentity.Type).
			StorageKey(edge.Column("person_id")),
		edge.To("attributes", PersonAttribute.Type).
			StorageKey(edge.Column("person_id")),
		edge.To("participants", RelationshipParticipant.Type).
			StorageKey(edge.Column("person_id")),
		edge.To("interaction_stats", PersonInteractionStat.Type).
			StorageKey(edge.Column("person_id")),
		edge.To("proposed_merge_candidates", PersonMergeCandidate.Type).
			StorageKey(edge.Column("proposed_person_id")),
		edge.To("existing_merge_candidates", PersonMergeCandidate.Type).
			StorageKey(edge.Column("existing_person_id")),
	}
}

// Indexes supports workspace-scoped listing and recency ordering.
func (Person) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("status"),
		index.Edges("workspace").Fields("last_interaction_at"),
		index.Edges("workspace").Fields("primary_email"),
	}
}
