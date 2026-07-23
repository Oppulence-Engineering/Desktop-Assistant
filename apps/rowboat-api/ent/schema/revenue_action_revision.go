package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// RevenueActionRevision is an immutable snapshot of the mutable fields of a
// RevenueAction at one revision (RFC 030). Editing recipient, sender account,
// assignee, channel, subject, message, or action type creates a new revision
// and invalidates the previous policy decision and approval.
type RevenueActionRevision struct{ ent.Schema }

// Mixin of the RevenueActionRevision.
func (RevenueActionRevision) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields of the RevenueActionRevision.
func (RevenueActionRevision) Fields() []ent.Field {
	return []ent.Field{
		field.Int("revision").Positive(),
		field.String("revision_hash").NotEmpty(),
		field.String("action_type").NotEmpty(),
		field.String("channel").NotEmpty(),
		field.String("recipient_email").Optional().Sensitive(),
		field.Text("reason").Optional(),
		field.Text("proposed_subject").Optional(),
		field.Text("proposed_message").Optional().Sensitive(),
		field.String("sender_account_ref").Optional(),
		field.UUID("assigned_user_id", uuid.UUID{}).Optional().Nillable(),
		field.UUID("created_by", uuid.UUID{}).Optional().Nillable(),
	}
}

// Edges of the RevenueActionRevision.
func (RevenueActionRevision) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("action", RevenueAction.Type).
			Ref("revisions").Unique().Required(),
		edge.From("user", User.Type).Ref("revenue_action_revisions").Unique().Required(),
	}
}

// Indexes of the RevenueActionRevision.
func (RevenueActionRevision) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("action").Fields("revision").Unique(),
	}
}
