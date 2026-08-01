package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// RelationshipReviewAcknowledgement is an immutable, user-specific boundary
// for "changed since my last review". A new state version creates a new row;
// prior review history is never overwritten.
type RelationshipReviewAcknowledgement struct{ ent.Schema }

// Mixin adds the common identifier and audit timestamps.
func (RelationshipReviewAcknowledgement) Mixin() []ent.Mixin {
	return []ent.Mixin{mixin.BaseMixin{}}
}

// Fields defines the exact canonical state version a user acknowledged.
func (RelationshipReviewAcknowledgement) Fields() []ent.Field {
	return []ent.Field{
		field.Int("state_version").NonNegative(),
		field.String("state_hash").Optional(),
		field.Time("acknowledged_at"),
	}
}

// Edges binds acknowledgement state to the tenant, relationship, and reviewer.
func (RelationshipReviewAcknowledgement) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).Ref("relationship_review_acknowledgements").Unique().Required(),
		edge.From("relationship", Relationship.Type).Ref("review_acknowledgements").Unique().Required(),
		edge.From("user", User.Type).Ref("relationship_review_acknowledgements").Unique().Required(),
	}
}

// Indexes enforce one acknowledgement per state version and accelerate recency reads.
func (RelationshipReviewAcknowledgement) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("relationship", "user").Fields("state_version").Unique(),
		index.Edges("workspace", "user").Fields("acknowledged_at"),
	}
}
