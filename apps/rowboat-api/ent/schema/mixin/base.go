// Package mixin holds reusable ent field sets shared across schemas.
package mixin

import (
	"time"

	"entgo.io/contrib/entproto"
	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/mixin"
	"github.com/google/uuid"
)

// BaseMixin gives every schema a UUID primary key and created/updated
// timestamps, keeping timestamp semantics uniform across the model.
// The entproto.Field numbers (1–3) apply only to schemas annotated with
// entproto.Message (currently User); other schemas ignore them.
type BaseMixin struct{ mixin.Schema }

// Fields of the BaseMixin.
func (BaseMixin) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New).
			Annotations(entproto.Field(1)),
		field.Time("created_at").Default(time.Now).Immutable().
			Annotations(entproto.Field(2)),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now).
			Annotations(entproto.Field(3)),
	}
}
