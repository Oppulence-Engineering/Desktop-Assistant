package schema

import (
	"time"

	"entgo.io/contrib/entgql"
	"entgo.io/contrib/entproto"
	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
	"github.com/flume/enthistory"
	"github.com/google/uuid"
)

// OAuthConnectionHistory stores immutable, credential-free OAuth lifecycle history.
type OAuthConnectionHistory struct {
	ent.Schema
}

// Fields defines immutable OAuth lifecycle metadata without credential bytes.
func (OAuthConnectionHistory) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).
			Annotations(entproto.Field(1)).
			Default(uuid.New),
		field.Time("history_time").
			Immutable().
			Default(time.Now),
		field.Enum("operation").
			Immutable().
			GoType(enthistory.OpType("")),
		field.UUID("ref", uuid.UUID{}).
			Optional().
			Immutable(),
		field.String("provider").
			Immutable(),
		field.Bool("refresh_token_present").
			Immutable().
			Default(false),
		field.Int64("credential_generation").
			Immutable().
			Default(1),
		field.JSON("scopes", []string{}).
			Optional().
			Immutable(),
		field.String("external_account_id").
			Optional().
			Immutable()}
}

// Edges intentionally omits a foreign key so delete history remains writable.
func (OAuthConnectionHistory) Edges() []ent.Edge {
	return nil
}

// Annotations marks this as manually triggered metadata-only history.
func (OAuthConnectionHistory) Annotations() []schema.Annotation {
	return []schema.Annotation{entgql.Annotation{Skip: entgql.SkipAll}, enthistory.Annotations{IsHistory: true, Triggers: []enthistory.OpType{}}}
}

// Mixin preserves tenant ownership and common timestamps in history.
func (OAuthConnectionHistory) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.UserTenantMixin{}}
}

// Indexes supports chronological history queries.
func (OAuthConnectionHistory) Indexes() []ent.Index {
	return []ent.Index{index.Fields("history_time")}
}
