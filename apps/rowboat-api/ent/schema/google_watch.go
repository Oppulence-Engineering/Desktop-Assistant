package schema

import (
	"entgo.io/contrib/entgql"
	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// GoogleWatch tracks one active Google push subscription per (user, kind):
// the Gmail users.watch registration, Calendar events channel, or Drive changes
// channel that
// makes Google deliver pushes to /v1/webhooks/google (RFC 003). Rows are
// created and renewed by the watch manager (internal/googlewatch); Google
// expires these registrations within days, so unrenewed rows simply go quiet.
type GoogleWatch struct{ ent.Schema }

// Mixin of the GoogleWatch.
func (GoogleWatch) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Annotations of the GoogleWatch.
func (GoogleWatch) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.RelayConnection(),
		entgql.QueryField(),
	}
}

// Fields of the GoogleWatch.
func (GoogleWatch) Fields() []ent.Field {
	return []ent.Field{
		field.String("kind").
			Validate(oneOfBackgroundTask("kind", "gmail", "calendar", "drive")),
		// account_email mirrors the connection's external_account_id at watch
		// time; webhook payloads resolve back through it.
		field.String("account_email").NotEmpty(),
		// channel_id / resource_id identify Calendar and Drive channels (Rowboat
		// mints channel_id as "gcal:{email}:{uuid}" or "gdrive:{email}:{uuid}");
		// empty for Gmail.
		field.String("channel_id").Optional(),
		field.String("resource_id").Optional(),
		// history_id is Gmail's mailbox cursor or Drive's changes page token.
		field.String("history_id").Optional(),
		// expires_at is Google's expiration for the registration. The zero-ish
		// past value on a fresh row marks it due for immediate (re)creation.
		field.Time("expires_at"),
		// renew_claimed_at is the renewal lease: a replica CASes it before
		// calling Google so concurrent renewers can't mint duplicate channels.
		field.Time("renew_claimed_at").Optional().Nillable(),
		field.Text("last_error").Optional(),
	}
}

// Edges of the GoogleWatch.
func (GoogleWatch) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("google_watches").Unique().Required(),
	}
}

// Indexes of the GoogleWatch.
func (GoogleWatch) Indexes() []ent.Index {
	return []ent.Index{
		// One watch per kind per user; the unique index is also the
		// cross-replica creation guard (the losing insert is skipped).
		index.Fields("kind").Edges("user").Unique(),
		index.Fields("expires_at"),
	}
}
