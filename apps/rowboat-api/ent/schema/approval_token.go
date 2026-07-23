package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// ApprovalToken is the server-side record of a single-use, scoped, expiring
// approval issued when an operator approves an ActionProposal (RFC 023). The
// token string itself is HMAC-signed and returned to the caller exactly once;
// only its hash is stored here, so a database read never yields a usable token.
//
// The row is the single-use ledger: execute atomically flips consumed=false →
// true under a predicate, so a replayed token finds the row already consumed
// and is rejected. params_hash binds the token to the exact params approved, so
// editing params (which re-hashes) invalidates any prior token — defeating an
// approve-then-swap.
type ApprovalToken struct{ ent.Schema }

// Mixin of the ApprovalToken.
func (ApprovalToken) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields of the ApprovalToken.
func (ApprovalToken) Fields() []ent.Field {
	return []ent.Field{
		// SHA-256 of the issued token string; the lookup key. Never the token.
		field.String("token_hash").NotEmpty().Unique(),
		field.String("proposal_id").NotEmpty(),
		// Binds the token to the exact params approved (SHA-256 of the canonical
		// params bytes). An edit re-hashes and invalidates this token.
		field.String("params_hash").NotEmpty(),
		field.String("operator_user_id").NotEmpty(),
		// Whether a step-up (MFA/recent-auth) assertion backed this approval.
		field.Bool("step_up").Default(false),
		field.Time("expires_at"),
		field.Bool("consumed").Default(false),
		field.Time("consumed_at").Optional().Nillable(),
	}
}

// Edges of the ApprovalToken.
func (ApprovalToken) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("approval_tokens").Unique().Required(),
	}
}

// Indexes of the ApprovalToken.
func (ApprovalToken) Indexes() []ent.Index {
	return []ent.Index{
		// The audit chain loads every token issued for a proposal by this key.
		index.Fields("proposal_id"),
	}
}
