package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// ActionProposal is a typed, closed-loop finance action the agent runtime
// *proposes* but never executes directly (RFC 023). The model can only reach an
// allowlisted propose-only tool; a money-touching action becomes reality only
// after an operator approves it in the cockpit and the approved action executes
// against the product Act seam with a single-use, params-bound approval token.
//
// The lifecycle is a strict state machine:
//
//	pending → approved → executed | failed
//	pending → rejected
//	approved/pending → expired
//
// The originating product's resulting state change returns as a CloudEvent and
// closes the loop, correlated by correlation_id + target.
type ActionProposal struct{ ent.Schema }

// Mixin of the ActionProposal.
func (ActionProposal) Mixin() []ent.Mixin { return []ent.Mixin{mixin.UserTenantMixin{}} }

// Fields of the ActionProposal.
func (ActionProposal) Fields() []ent.Field {
	return []ent.Field{
		// resourceRef of the object the action operates, e.g.
		// "conduit:invoice:inv_456". The Watch leg matches the product's return
		// event to this proposal by target + correlation_id.
		field.String("target").NotEmpty(),
		// Product-defined action kind, e.g. "conduit.dunning.advance". Drawn from
		// the product manifests (RFC 020); low-cardinality (a catalog), so it is
		// safe as a metric label.
		field.String("kind").NotEmpty(),
		// Product-defined, schema-validated params. Stored as validated JSON text
		// (the house pattern for free-form JSON that entgql cannot type). The
		// approval token hashes these exact bytes, so an edit invalidates it.
		field.Text("params_json").Optional().Validate(validJSON),
		// financial ⇒ requires a money-touching token and (by default) step-up
		// auth before approval. The model may only *propose* financial kinds.
		field.Bool("financial").Default(false),
		// Why the runtime proposed this; rendered on the approval card.
		field.Text("rationale").Optional().Sensitive(),
		field.String("status").
			Default("pending").
			Validate(oneOfRevenue("status",
				"pending", "approved", "rejected", "executed", "failed",
				"executed_unconfirmed", "expired")),
		// Echoed to the product on execute and matched on the return CloudEvent
		// to correlate the loop closure back to this proposal (idempotency anchor
		// for at-least-once return events).
		field.String("correlation_id").Optional(),
		// RFC 022 entity this concerns (e.g. the Acme relationship), when known.
		field.String("entity_id").Optional(),
		// The originating background_task_run, when the proposal came from a run.
		// Optional so proposals can also be created directly (tests, cockpit).
		field.String("origin_run_id").Optional(),
		// When a pending/approved proposal auto-expires.
		field.Time("expires_at").Optional().Nillable(),
		field.Time("approved_at").Optional().Nillable(),
		field.Time("executed_at").Optional().Nillable(),
		// Reason captured on reject or failure; surfaced on the card/audit.
		field.Text("reason").Optional(),
		// The product's resulting object id after a successful execute (e.g. the
		// new dunning step id). Links execution to the eventual return event.
		field.String("result_ref").Optional(),
		// Watch leg (RFC 023 WP4): the product's return CloudEvent that closed
		// the loop, and when. resolved_at is the idempotency anchor — a duplicate
		// return event finds it already set and is a no-op.
		field.String("return_event_id").Optional(),
		field.Time("resolved_at").Optional().Nillable(),
	}
}

// Edges of the ActionProposal.
func (ActionProposal) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("action_proposals").Unique().Required().Immutable(),
	}
}

// Indexes of the ActionProposal.
func (ActionProposal) Indexes() []ent.Index {
	return []ent.Index{
		// Cockpit pending queue and per-object audit both scan by these.
		index.Fields("status"),
		index.Fields("target"),
		index.Fields("correlation_id"),
	}
}
