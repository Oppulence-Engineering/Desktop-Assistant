package revenue

import (
	"context"
	"errors"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
)

// ErrSubscriptionRequired means the caller may observe, scan, review, and draft
// for free, but acting on an action (approve/execute) needs a paid plan.
var ErrSubscriptionRequired = errors.New("revenue: an active subscription is required to act on actions")

// Entitlements decides whether a user may perform the paid execution steps.
// Reading, scanning, editing, and reviewing are always free; only approve and
// execute are gated (product decision: gate execution only).
type Entitlements interface {
	// CanExecute reports whether the user has a paid, active plan.
	CanExecute(ctx context.Context, u *ent.User) (bool, error)
}

// SetEntitlements installs the paywall. A nil checker (the default, and what
// the scheduler contexts use) allows everything.
func (s *Service) SetEntitlements(e Entitlements) { s.entitlements = e }

func (s *Service) requireEntitled(ctx context.Context, u *ent.User) error {
	if s.entitlements == nil {
		return nil
	}
	ok, err := s.entitlements.CanExecute(ctx, u)
	if err != nil {
		return err
	}
	if !ok {
		return ErrSubscriptionRequired
	}
	return nil
}

// SubscriptionEntitlements gates execution on a paid, active/trialing plan.
// A missing subscription, the "free" plan, or a non-active status all mean
// "not entitled". The subscription query is tenant-scoped by the interceptors.
type SubscriptionEntitlements struct {
	client *ent.Client
}

// NewSubscriptionEntitlements builds the real paywall.
func NewSubscriptionEntitlements(client *ent.Client) *SubscriptionEntitlements {
	return &SubscriptionEntitlements{client: client}
}

// CanExecute implements Entitlements against the Subscription entity.
func (e *SubscriptionEntitlements) CanExecute(ctx context.Context, _ *ent.User) (bool, error) {
	sub, err := e.client.Subscription.Query().Only(ctx)
	if ent.IsNotFound(err) {
		return false, nil // no subscription row → free tier → not entitled to act
	}
	if err != nil {
		return false, err
	}
	active := sub.Status == "active" || sub.Status == "trialing"
	paid := sub.Plan != "" && sub.Plan != "free"
	return active && paid, nil
}
