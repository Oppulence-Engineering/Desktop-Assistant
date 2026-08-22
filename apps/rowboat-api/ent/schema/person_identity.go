package schema

import (
	"entgo.io/contrib/entoas"
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// PersonIdentity is the durable, normalized identity anchor for a canonical person.
//
// It deliberately mirrors RelationshipIdentity — same sha256 key_hash grammar, same
// workspace-unique index, same never-auto-merge posture — but lives in its own table
// because the two namespaces must not compete for the same key. A kind="person"
// Relationship for jane@acme.com and the Person jane@acme.com both legitimately own
// that address; sharing one unique index would let exactly one win and manufacture a
// review item on every single ingest, forever.
//
// There is no "domain" kind here, and that is structural rather than enforced at
// runtime. RelationshipIdentity strips domain anchors for non-company relationships
// because a corporate domain is shared by every employee; for a person that reasoning
// is not conditional, so the constraint is moved into the enum where it cannot be
// bypassed.
type PersonIdentity struct{ ent.Schema }

// Mixin adds the shared immutable ID and timestamp fields.
func (PersonIdentity) Mixin() []ent.Mixin { return []ent.Mixin{mixin.WorkspaceTenantMixin{}} }

// Fields defines the person identity anchor columns.
func (PersonIdentity) Fields() []ent.Field {
	return []ent.Field{
		field.String("kind").
			Validate(oneOfRevenue("kind", "email", "resource_ref", "handle")),
		field.String("provider").Optional(),
		field.String("key_hash").NotEmpty().Sensitive().Annotations(entoas.Skip(true)),
		field.String("normalized_value").NotEmpty().Sensitive().Annotations(entoas.Skip(true)),
		field.String("source").Optional(),
		field.Float("confidence").Default(1).Min(0).Max(1),
		field.Time("first_seen_at"),
		field.Time("last_seen_at"),
	}
}

// Edges defines the anchor's workspace, person, and user ownership.
func (PersonIdentity) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("person_identities").Unique().Required().Immutable(),
		edge.From("person", Person.Type).
			Ref("identities").Unique().Required(),
		edge.From("user", User.Type).
			Ref("person_identities").Unique().Required().Immutable(),
	}
}

// Indexes enforces workspace-wide person identity uniqueness.
func (PersonIdentity) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("key_hash").Unique(),
		index.Edges("person").Fields("kind"),
	}
}
