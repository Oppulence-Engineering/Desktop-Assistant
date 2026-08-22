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

// OAuthConnection holds long-lived third-party OAuth tokens (e.g. Google).
// The refresh token is sealed at the application layer (AES-256-GCM) before
// it ever reaches the database column.
type OAuthConnection struct{ ent.Schema }

// Mixin of the OAuthConnection.
func (OAuthConnection) Mixin() []ent.Mixin { return []ent.Mixin{mixin.UserTenantMixin{}} }

// Annotations excludes the history table from GraphQL (entgql.Skip).
func (OAuthConnection) Annotations() []schema.Annotation {
	return []schema.Annotation{
		enthistory.Annotations{Annotations: []schema.Annotation{entgql.Skip()}},
	}
}

// Fields of the OAuthConnection.
func (OAuthConnection) Fields() []ent.Field {
	return []ent.Field{
		field.String("provider"), // google
		field.Bytes("refresh_token_encrypted").Sensitive(),
		field.Strings("scopes").Optional(),
		// external_account_id is the provider-side account key (google: the
		// account email; slack: the team id). Provider webhooks resolve the
		// owning Rowboat user through it (RFC 003). Optional: connections made
		// before this field exists backfill on their next reconnect.
		field.String("external_account_id").Optional(),
	}
}

// Edges of the OAuthConnection.
func (OAuthConnection) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("oauth_connections").Unique().Required().Immutable(),
	}
}

// Indexes of the OAuthConnection.
func (OAuthConnection) Indexes() []ent.Index {
	return []ent.Index{
		// Provider webhooks resolve a tenant solely from (provider,
		// external_account_id), so that key must have exactly one owner globally.
		// Optional NULL values remain available for legacy rows that predate an
		// external account id. A user may still connect multiple distinct accounts.
		index.Fields("provider", "external_account_id").Unique(),
	}
}
