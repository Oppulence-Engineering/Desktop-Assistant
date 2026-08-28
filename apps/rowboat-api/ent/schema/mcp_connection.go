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
		// organization_id is captured when the credential is connected and never
		// follows the mutable organization mirror on User. Legacy rows without a
		// trustworthy organization are invalidated by the rollout migration and
		// remain unresolvable until the user explicitly reconnects.
		field.String("organization_id").Optional().Immutable(),
		field.Strings("scopes").Optional(),
		field.Bytes("refresh_token_encrypted").Optional().Sensitive(), // Ory-issued, rotated on use
		field.Bytes("api_key_encrypted").Optional().Sensitive(),       // vendor-issued (api_key connectors)
		// Presence flags are safe lifecycle metadata copied into immutable
		// history. A schema hook derives them from credential mutations so
		// history never needs the credential ciphertext itself.
		field.Bool("refresh_token_present").Default(false),
		field.Bool("api_key_present").Default(false),
		// credential_generation is advanced whenever a credential is replaced.
		// Long-running refresh/revoke operations use it as a fencing token so an
		// older operation cannot mutate a newly reconnected grant.
		field.Int64("credential_generation").Default(1).Positive(),
		field.String("status").Default("active").Validate(oneOf(
			"mcp connection status",
			"active",
			"reauth_required",
			"revoking",
			"revoked",
			"invalidated",
			"error",
		)),
		field.Time("connected_at").Optional(),
		field.Time("last_used_at").Optional(),
		field.Time("expires_at").Optional(), // refresh-token / api-key expiry
		field.Time("revoked_at").Optional(),
		field.String("revoked_reason").Optional(),
		field.String("revoked_by").Optional(),
		field.Time("revocation_attempted_at").Optional(),
		field.Bool("revocation_succeeded").Optional(),
	}
}

// Hooks derives safe credential metadata before enthistory observes a mutation.
func (MCPConnection) Hooks() []ent.Hook { return []ent.Hook{connectorCredentialMetadataHook(false)} }

// Edges of the MCPConnection.
func (MCPConnection) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("mcp_connections").Unique().Required().Immutable(),
	}
}

// Indexes of the MCPConnection.
func (MCPConnection) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("connector", "organization_id").Edges("user").Unique(),
		index.Fields("status"),
		index.Fields("organization_id", "connector", "status"),
	}
}
