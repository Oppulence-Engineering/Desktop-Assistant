package billing

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/stripe/stripe-go/v86"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/subscription"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

// CancelSubscriptions cancels, immediately, every live Stripe subscription of
// the user, so a deleted account is never charged again. It lists the Stripe
// customer's subscriptions instead of trusting the one id stored locally: a
// missed webhook can leave a second subscription that the local row does not
// know about. It returns the number of subscriptions it cancelled.
func (h *Handler) CancelSubscriptions(ctx context.Context, u *ent.User) (int, error) {
	sub, err := h.client.Subscription.Query().
		Where(subscription.HasUserWith(user.IDEQ(u.ID))).
		Only(auth.WithInternal(ctx))
	if ent.IsNotFound(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if sub.StripeCustomerID == "" && sub.StripeSubscriptionID == "" {
		return 0, nil
	}
	if h.stripe.SecretKey == "" {
		// The user has Stripe billing, but this deployment cannot reach Stripe.
		// Fail instead of deleting an account that Stripe keeps charging.
		return 0, errStripeUnconfigured
	}
	sc := stripe.NewClient(h.stripe.SecretKey, stripe.WithBackends(stripe.NewBackendsWithConfig(&stripe.BackendConfig{
		URL:        stripe.String(h.stripe.APIBaseURL),
		HTTPClient: h.stripeHTTP,
		// Stripe error messages can name customer details; errors are
		// summarised by stripeSDKError instead of logged by the SDK.
		LeveledLogger: &stripe.LeveledLogger{Level: stripe.LevelNull},
	})))

	status := map[string]stripe.SubscriptionStatus{}
	if sub.StripeCustomerID != "" {
		params := &stripe.SubscriptionListParams{
			Customer: stripe.String(sub.StripeCustomerID),
			Status:   stripe.String("all"),
		}
		for ss, err := range sc.V1Subscriptions.List(ctx, params).All(ctx) {
			if err != nil {
				return 0, stripeSDKError("list subscriptions", err)
			}
			status[ss.ID] = ss.Status
		}
	}
	if id := sub.StripeSubscriptionID; id != "" {
		if _, listed := status[id]; !listed {
			ss, err := sc.V1Subscriptions.Retrieve(ctx, id, nil)
			switch {
			case isStripeNotFound(err):
			case err != nil:
				return 0, stripeSDKError("retrieve subscription", err)
			default:
				status[id] = ss.Status
			}
		}
	}

	cancelled := 0
	for id, st := range status {
		if st == stripe.SubscriptionStatusCanceled || st == stripe.SubscriptionStatusIncompleteExpired {
			continue
		}
		if _, err := sc.V1Subscriptions.Cancel(ctx, id, nil); err != nil {
			if isStripeNotFound(err) {
				continue
			}
			return cancelled, stripeSDKError("cancel subscription", err)
		}
		cancelled++
	}
	return cancelled, nil
}

func isStripeNotFound(err error) bool {
	var stripeErr *stripe.Error
	return errors.As(err, &stripeErr) && stripeErr.HTTPStatusCode == http.StatusNotFound
}

// stripeSDKError keeps the Stripe message out of the error, like doStripe does:
// callers log errors, and the message can name customer or payment details.
func stripeSDKError(op string, err error) error {
	var stripeErr *stripe.Error
	if errors.As(err, &stripeErr) {
		return fmt.Errorf("stripe %s returned %d (%s)", op, stripeErr.HTTPStatusCode, stripeErr.Code)
	}
	return fmt.Errorf("stripe %s: %w", op, err)
}
