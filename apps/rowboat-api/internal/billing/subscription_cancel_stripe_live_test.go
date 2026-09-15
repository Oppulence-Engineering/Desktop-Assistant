//go:build stripelive

package billing_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/stripe/stripe-go/v86"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/billing"
)

// TestCancelSubscriptionsAgainstStripeTestMode runs CancelSubscriptions against
// the real Stripe API in test mode, where no money moves. Run it with:
//
//	STRIPE_TEST_SECRET_KEY=sk_test_... STRIPE_TEST_PRICE_ID=price_... \
//	  go test -tags stripelive ./internal/billing -run TestCancelSubscriptionsAgainstStripeTestMode -v
func TestCancelSubscriptionsAgainstStripeTestMode(t *testing.T) {
	key, price := os.Getenv("STRIPE_TEST_SECRET_KEY"), os.Getenv("STRIPE_TEST_PRICE_ID")
	if key == "" || price == "" {
		t.Skip("set STRIPE_TEST_SECRET_KEY and STRIPE_TEST_PRICE_ID")
	}
	if !strings.HasPrefix(key, "sk_test_") {
		t.Fatal("STRIPE_TEST_SECRET_KEY must be a test-mode key")
	}
	ctx := context.Background()
	sc := stripe.NewClient(key)

	customer, err := sc.V1Customers.Create(ctx, &stripe.CustomerCreateParams{
		Description: stripe.String("rowboat account deletion test"),
	})
	if err != nil {
		t.Fatalf("create customer: %v", err)
	}
	t.Cleanup(func() { _, _ = sc.V1Customers.Delete(context.Background(), customer.ID, nil) })

	// Trial subscriptions need no payment method, and nothing is charged.
	subscribe := func() *stripe.Subscription {
		s, err := sc.V1Subscriptions.Create(ctx, &stripe.SubscriptionCreateParams{
			Customer:        stripe.String(customer.ID),
			Items:           []*stripe.SubscriptionCreateItemParams{{Price: stripe.String(price)}},
			TrialPeriodDays: stripe.Int64(7),
		})
		if err != nil {
			t.Fatalf("create subscription: %v", err)
		}
		return s
	}
	stored := subscribe()
	// The local row does not know about the second subscription.
	unknown := subscribe()

	client := testClient(t)
	h := billing.New(client, 10000, 0, nil, zap.NewNop())
	h.ConfigureStripe(billing.StripeConfig{SecretKey: key, APIBaseURL: "https://api.stripe.com"})
	u := billedUser(t, client, "stripelive", customer.ID, stored.ID)

	n, err := h.CancelSubscriptions(ctx, u)
	if err != nil || n != 2 {
		t.Fatalf("CancelSubscriptions = %d, %v; want 2, nil", n, err)
	}
	for _, id := range []string{stored.ID, unknown.ID} {
		s, err := sc.V1Subscriptions.Retrieve(ctx, id, nil)
		if err != nil {
			t.Fatalf("retrieve %s: %v", id, err)
		}
		if s.Status != stripe.SubscriptionStatusCanceled {
			t.Errorf("subscription %s status = %s, want canceled", id, s.Status)
		}
	}

	n, err = h.CancelSubscriptions(ctx, u)
	if err != nil || n != 0 {
		t.Fatalf("second CancelSubscriptions = %d, %v; want 0, nil", n, err)
	}
}
