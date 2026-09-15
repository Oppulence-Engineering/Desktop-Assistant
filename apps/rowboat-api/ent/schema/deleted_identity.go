package schema

import (
	"entgo.io/contrib/entgql"
	"entgo.io/contrib/entoas"
	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// DeletedIdentity records a deleted account. A WorkOS access token issued
// before the deletion stays valid until it expires; this tombstone stops that
// token from creating the account again. It holds only a SHA-256 hash of the
// WorkOS user id, and no personal data.
type DeletedIdentity struct{ ent.Schema }

// Annotations keeps the tombstones internal.
func (DeletedIdentity) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.Annotation{Skip: entgql.SkipAll},
		entoas.Skip(true),
	}
}

// Mixin attaches common identity and timestamp fields.
func (DeletedIdentity) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields declares the hashed WorkOS user id.
func (DeletedIdentity) Fields() []ent.Field {
	return []ent.Field{
		field.String("key_hash").NotEmpty().Immutable(),
	}
}

// Indexes records each deleted identity once.
func (DeletedIdentity) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("key_hash").Unique(),
	}
}
