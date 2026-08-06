package schema

import (
	"entgo.io/contrib/entoas"
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// PersonSuppression records an identity that must never resolve to a Person again.
//
// Deleting person rows alone does not delete a person. Every sync re-derives people
// from message headers and calendar invites, so resolvePerson recreates whoever was
// removed on the next pass — with the same name, the same address, and a new ID. A
// delete that undoes itself overnight is not a delete, and for a counterparty who
// asked to be removed it is worse than never offering one.
//
// This is the tombstone that makes removal stick. It stores the identity anchor
// hash, never the address itself: the point is to recognise an identity on sight
// without retaining the identifier that was asked to be forgotten. resolvePerson
// checks it beside the no-reply test, before any signal is computed or any row is
// written.
//
// Workspace-scoped rather than global. Suppression is a statement about one
// workspace's records, and a person removed from one customer's graph has no
// bearing on another's.
type PersonSuppression struct{ ent.Schema }

// Mixin adds the shared immutable ID and timestamp fields.
func (PersonSuppression) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields defines the suppression anchor columns.
func (PersonSuppression) Fields() []ent.Field {
	return []ent.Field{
		// Same sha256(kind + "\x00" + value) grammar as PersonIdentity, so a
		// suppressed identity is recognised by the hash resolution already computes.
		field.String("key_hash").NotEmpty().Sensitive().Annotations(entoas.Skip(true)),
		field.String("kind").
			Validate(oneOfRevenue("kind", "email", "resource_ref", "handle")),
		// Why it was suppressed. `subject_request` is a person asking to be removed
		// and is the case that must never be silently reversed; `user_action` is the
		// account holder tidying their own graph.
		field.String("reason").
			Default("user_action").
			Validate(oneOfRevenue("reason", "user_action", "subject_request")),
		field.Time("suppressed_at"),
		// Free-text note from the operator, for the audit trail. Never rendered to
		// anyone but the workspace that wrote it.
		field.String("note").Optional(),
	}
}

// Edges defines workspace and user ownership.
func (PersonSuppression) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("person_suppressions").Unique().Required(),
		edge.From("user", User.Type).
			Ref("person_suppressions").Unique().Required(),
	}
}

// Indexes enforces one suppression per identity per workspace and keeps the
// resolution-time lookup a single indexed hit.
func (PersonSuppression) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("key_hash").Edges("workspace").Unique(),
	}
}
