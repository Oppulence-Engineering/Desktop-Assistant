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

// UTCNow is the shared time default for every schema timestamp. Always UTC:
// SQLite stores time as TEXT, so a local-zone default makes ts-window queries
// and keyset cursors (which compare against UTC bounds) silently miss or
// duplicate rows around the local/UTC date boundary — daily spend caps and
// cloud-event pagination both hit this in dev. Postgres (timestamptz) is
// unaffected either way.
func UTCNow() time.Time { return time.Now().UTC() }

// Fields of the BaseMixin.
func (BaseMixin) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New).
			Annotations(entproto.Field(1)),
		field.Time("created_at").Default(UTCNow).Immutable().
			Annotations(entproto.Field(2)),
		field.Time("updated_at").Default(UTCNow).UpdateDefault(UTCNow).
			Annotations(entproto.Field(3)),
	}
}
