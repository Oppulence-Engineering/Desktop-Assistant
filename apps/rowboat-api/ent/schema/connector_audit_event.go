package schema

import (
	"entgo.io/contrib/entgql"
	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// ConnectorAuditEvent is an append-only semantic record of broker lifecycle,
// consent, minting, and revocation decisions. It intentionally stores no token,
// API key, OAuth code, raw state, or provider response body.
type ConnectorAuditEvent struct{ ent.Schema }

// Mixin attaches the repository-standard user tenant ownership fields.
func (ConnectorAuditEvent) Mixin() []ent.Mixin { return []ent.Mixin{mixin.UserTenantMixin{}} }

// Annotations keeps connector audit rows out of the public GraphQL schema.
func (ConnectorAuditEvent) Annotations() []schema.Annotation {
	return []schema.Annotation{entgql.Skip()}
}

// Fields defines credential-free, bounded connector decision metadata.
func (ConnectorAuditEvent) Fields() []ent.Field {
	return []ent.Field{
		field.String("event_type").NotEmpty().Immutable(),
		field.String("event_id").Optional().Unique().Immutable(),
		field.String("connector").NotEmpty().Immutable(),
		field.UUID("connection_id", uuid.UUID{}).Optional().Immutable(),
		field.String("owner_workos_user_id").NotEmpty().Immutable(),
		field.String("org_id").Optional().Immutable(),
		field.String("audience").Optional().Immutable(),
		field.Strings("requested_scopes").Optional().Immutable(),
		field.Strings("granted_scopes").Optional().Immutable(),
		field.String("actor_kind").Optional().Immutable(),
		field.String("reason").Optional().Immutable(),
		field.String("metadata_json").Optional().Immutable(),
		field.String("consent_session_id").Optional().Immutable(),
		field.String("context_request_id").Optional().Immutable(),
		field.String("challenge").Optional().Immutable(),
		field.String("client_id").Optional().Immutable(),
		field.String("result").Optional().Immutable(),
		field.Time("occurred_at").Optional().Immutable(),
	}
}

// Edges binds every connector audit event immutably to its owning user.
func (ConnectorAuditEvent) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("connector_audit_events").Unique().Required().Immutable(),
	}
}

// Indexes supports lifecycle, tenant, connection, and consent audit queries.
func (ConnectorAuditEvent) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("event_type", "created_at"),
		index.Fields("connector", "created_at"),
		index.Fields("connection_id", "created_at"),
		index.Fields("owner_workos_user_id", "created_at"),
		index.Fields("org_id", "created_at"),
		index.Fields("consent_session_id", "created_at"),
		index.Fields("context_request_id", "created_at"),
	}
}
