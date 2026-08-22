package schema

import (
	"entgo.io/contrib/entgql"
	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/flume/enthistory"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// MCPConnection is per-(user, product) connector OAuth state. Either an
// Ory-issued refresh token (oauth connectors) or a vendor-issued API key
// (api_key connectors like Canvas/Corinthian) is held, sealed at rest.
type MCPConnection struct{ ent.Schema }

// Mixin of the MCPConnection.
func (MCPConnection) Mixin() []ent.Mixin { return []ent.Mixin{mixin.UserTenantMixin{}} }

// Annotations of the MCPConnection (GraphQL exposure via entgql).
func (MCPConnection) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.RelayConnection(),
		entgql.QueryField(),
		enthistory.Annotations{Annotations: []schema.Annotation{entgql.Skip()}},
	}
}

// Fields of the MCPConnection.
func (MCPConnection) Fields() []ent.Field {
	return []ent.Field{
		field.String("connector"), // canvas | corinthian | billflow | wispr
		field.String("audience"),  // canvas-api | corinthian-api | ...
		field.Strings("scopes").Optional(),
		field.Bytes("refresh_token_encrypted").Optional().Sensitive(), // Ory-issued, rotated on use
		field.Bytes("api_key_encrypted").Optional().Sensitive(),       // vendor-issued (api_key connectors)
		field.Time("connected_at").Optional(),
		field.Time("last_used_at").Optional(),
		field.Time("expires_at").Optional(), // refresh-token / api-key expiry
	}
}

// Edges of the MCPConnection.
func (MCPConnection) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("mcp_connections").Unique().Required().Immutable(),
	}
}

// Indexes of the MCPConnection.
func (MCPConnection) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("connector").Edges("user").Unique(),
	}
}
