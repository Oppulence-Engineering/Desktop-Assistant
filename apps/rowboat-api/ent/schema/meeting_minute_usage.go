package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// MeetingMinuteUsage meters a user's free *cloud* meeting-transcription minutes
// per UTC month (RFC 009 §16, Appendix O). One row per (user, period).
//
// `used_seconds` is the settled counter; `reserved_seconds` holds in-flight
// reservations (reserve → settle/refund), mirroring the credit-ledger gate's
// shape but as a small per-period counter rather than an append-only ledger —
// the free allowance is a plan attribute, not priced credits. Paid plans and
// BYOK callers bypass the gate entirely (unlimited cloud).
type MeetingMinuteUsage struct{ ent.Schema }

// Mixin gives the row a UUID id + created_at/updated_at (used by the stale
// reservation sweeper).
func (MeetingMinuteUsage) Mixin() []ent.Mixin { return []ent.Mixin{mixin.UserTenantMixin{}} }

// Fields of the MeetingMinuteUsage.
func (MeetingMinuteUsage) Fields() []ent.Field {
	return []ent.Field{
		field.String("period").Immutable(), // "2026-06" (UTC month)
		field.Int("used_seconds").Default(0).NonNegative(),
		field.Int("reserved_seconds").Default(0).NonNegative(),
	}
}

// Edges of the MeetingMinuteUsage.
func (MeetingMinuteUsage) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("meeting_minute_usages").Unique().Required().Immutable(),
	}
}

// Indexes of the MeetingMinuteUsage. One row per (user, period); the unique
// constraint also serves as the upsert anchor for concurrent reservations.
func (MeetingMinuteUsage) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("period").Edges("user").Unique(),
	}
}
