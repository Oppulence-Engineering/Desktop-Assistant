package revenue

import (
	"context"
	"errors"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

// grantSub gives the fixture user a subscription row with the given plan/status.
func grantSub(t *testing.T, f *fixture, plan, status string) {
	t.Helper()
	f.client.Subscription.Create().
		SetUser(f.user).SetPlan(plan).SetStatus(status).
		SaveX(auth.WithInternal(context.Background()))
}

func TestExecutionGatedBehindSubscription(t *testing.T) {
	f := newFixture(t)
	f.svc.SetEntitlements(NewSubscriptionEntitlements(f.client))

	action := f.action(t, ExecModeDraft)

	// No subscription → approve is refused with the paywall error.
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); !errors.Is(err, ErrSubscriptionRequired) {
		t.Fatalf("approve without subscription: want ErrSubscriptionRequired, got %v", err)
	}

	// The free plan is not enough.
	grantSub(t, f, "free", "active")
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); !errors.Is(err, ErrSubscriptionRequired) {
		t.Fatalf("approve on free plan: want ErrSubscriptionRequired, got %v", err)
	}

	// A paid, active plan unlocks approve + execute.
	f.client.Subscription.Update().SetPlan("pro").SetStatus("active").SaveX(f.ctx)
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); err != nil {
		t.Fatalf("approve on paid plan: %v", err)
	}
	if _, err := f.svc.Execute(f.ctx, f.user, action.ID); err != nil {
		t.Fatalf("execute on paid plan: %v", err)
	}
}

func TestFreeStepsAreNotGated(t *testing.T) {
	f := newFixture(t)
	f.svc.SetEntitlements(NewSubscriptionEntitlements(f.client))
	f.svc.SetSweeper(&fakeSweeper{email: selfAddr})

	// No subscription — scanning, listing, editing, snoozing, dismissing all work.
	if _, err := f.svc.StartScan(f.ctx, f.user, 90); err != nil {
		t.Fatalf("scan should be free: %v", err)
	}
	action := f.action(t, ExecModeDraft)
	if _, err := f.svc.ListActions(f.ctx, f.user, ListFilter{}); err != nil {
		t.Fatalf("list should be free: %v", err)
	}
	subject := "edited"
	if _, err := f.svc.EditAction(f.ctx, f.user, action.ID, EditInput{ProposedSubject: &subject}); err != nil {
		t.Fatalf("edit should be free: %v", err)
	}
	if _, err := f.svc.Impact(f.ctx, f.user); err != nil {
		t.Fatalf("impact should be free: %v", err)
	}
}

func TestPastDuePlanIsGated(t *testing.T) {
	f := newFixture(t)
	f.svc.SetEntitlements(NewSubscriptionEntitlements(f.client))
	grantSub(t, f, "pro", "past_due")
	action := f.action(t, ExecModeDraft)
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); !errors.Is(err, ErrSubscriptionRequired) {
		t.Fatalf("past_due must be gated, got %v", err)
	}
	// Cross-check the entitlement helper directly.
	e := NewSubscriptionEntitlements(f.client)
	ok, err := e.CanExecute(f.ctx, f.user)
	if err != nil || ok {
		t.Fatalf("past_due CanExecute = %v, %v; want false, nil", ok, err)
	}
}
