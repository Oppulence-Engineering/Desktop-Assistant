package schema

import (
	"fmt"
	"slices"

	"entgo.io/contrib/entgql"
	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"github.com/flume/enthistory"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

func oneOf(field string, allowed ...string) func(string) error {
	return func(v string) error {
		if slices.Contains(allowed, v) {
			return nil
		}
		return fmt.Errorf("%s must be one of %v, got %q", field, allowed, v)
	}
}

// Subscription holds a user's plan, status and credit grant. One per user.
type Subscription struct{ ent.Schema }

// Mixin of the Subscription.
func (Subscription) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Annotations of the Subscription (GraphQL exposure via entgql). The GraphQL
// type is renamed to avoid colliding with GraphQL's reserved `Subscription`
// root operation type.
func (Subscription) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.Type("BillingSubscription"),
		entgql.RelayConnection(),
		entgql.QueryField("billingSubscriptions"),
		enthistory.Annotations{Annotations: []schema.Annotation{entgql.Skip()}},
	}
}

// Fields of the Subscription.
func (Subscription) Fields() []ent.Field {
	return []ent.Field{
		// Plan values must match BillingPlan in apps/x/packages/shared/src/billing.ts:
		// 'free' | 'starter' | 'pro' | 'intelligence'. Stored as a validated string
		// (not an ent Enum) so enthistory can mirror the field into the history table.
		//
		// `intelligence` is the cloud-research tier (RFC 039). It is a separate plan
		// rather than a higher `pro` because research is consent-gated: a user who
		// declines to send counterparty details to a vendor must not be repriced for
		// a capability they switched off.
		field.String("plan").Default("free").
			Validate(oneOf("plan", "free", "starter", "pro", "intelligence")),
		field.String("status").Default("active").
			Validate(oneOf("status", "active", "trialing", "past_due", "canceled")),
		field.Time("trial_expires_at").Optional().Nillable(),
		field.Int("sanctioned_credits").Default(10000).NonNegative(),
		field.String("stripe_customer_id").Optional(),
		field.String("stripe_subscription_id").Optional(),
	}
}

// Edges of the Subscription.
func (Subscription) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("subscription").Unique().Required(),
	}
}
