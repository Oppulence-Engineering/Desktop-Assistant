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
func (OAuthConnection) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

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
		edge.From("user", User.Type).Ref("oauth_connections").Unique().Required(),
	}
}

// Indexes of the OAuthConnection.
func (OAuthConnection) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("provider").Edges("user").Unique(),
		// Webhook user resolution: (provider, external_account_id) lookups run
		// under the internal context. Non-unique: nothing prevents two Rowboat
		// users from connecting the same provider account.
		index.Fields("provider", "external_account_id"),
	}
}
