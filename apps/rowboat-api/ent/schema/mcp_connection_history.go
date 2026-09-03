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

// MCPConnectionHistory stores immutable, credential-free MCP lifecycle history.
type MCPConnectionHistory struct {
	ent.Schema
}

// Fields defines immutable MCP lifecycle metadata without credential bytes.
func (MCPConnectionHistory) Fields() []ent.Field {
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
		field.String("connector").
			Immutable(),
		field.String("audience").
			Immutable(),
		field.String("organization_id").
			Optional().
			Immutable(),
		field.JSON("scopes", []string{}).
			Optional().
			Immutable(),
		field.Bool("refresh_token_present").
			Immutable().
			Default(false),
		field.Bool("api_key_present").
			Immutable().
			Default(false),
		field.Int64("credential_generation").
			Immutable().
			Default(1),
		field.String("status").
			Immutable().
			Default("active"),
		field.Time("connected_at").
			Optional().
			Immutable(),
		field.Time("last_used_at").
			Optional().
			Immutable(),
		field.Time("expires_at").
			Optional().
			Immutable(),
		field.Time("revoked_at").
			Optional().
			Immutable(),
		field.String("revoked_reason").
			Optional().
			Immutable(),
		field.String("revoked_by").
			Optional().
			Immutable(),
		field.Time("revocation_attempted_at").
			Optional().
			Immutable(),
		field.Bool("revocation_succeeded").
			Optional().
			Immutable()}
}

// Edges intentionally omits a foreign key so delete history remains writable.
func (MCPConnectionHistory) Edges() []ent.Edge {
	return nil
}

// Annotations marks this as manually triggered metadata-only history.
func (MCPConnectionHistory) Annotations() []schema.Annotation {
	return []schema.Annotation{entgql.Annotation{Skip: entgql.SkipAll}, enthistory.Annotations{IsHistory: true, Triggers: []enthistory.OpType{}}}
}

// Mixin preserves tenant ownership and common timestamps in history.
func (MCPConnectionHistory) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.UserTenantMixin{}}
}

// Indexes supports chronological history queries.
func (MCPConnectionHistory) Indexes() []ent.Index {
	return []ent.Index{index.Fields("history_time")}
}
