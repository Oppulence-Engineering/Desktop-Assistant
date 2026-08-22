package db_test

import (
	"context"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"go.uber.org/zap"
)

// TestHistoryTracking proves enthistory records insert/update history rows.
func TestHistoryTracking(t *testing.T) {
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:histtest?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	ctx := context.Background()
	c := d.Client

	u := c.User.Create().SetEmail("a@x.co").SetWorkosUserID("u1").SaveX(ctx)

	// One insert → one history row.
	if n := c.UserHistory.Query().CountX(ctx); n != 1 {
		t.Fatalf("after create, user_history = %d, want 1", n)
	}

	// Update → another history row.
	u.Update().SetEmail("b@x.co").SaveX(ctx)
	if n := c.UserHistory.Query().CountX(ctx); n != 2 {
		t.Fatalf("after update, user_history = %d, want 2", n)
	}

	// Subscription history works for the string-typed plan/status too.
	sub := c.Subscription.Create().SetUser(u).SetSanctionedCredits(10000).SaveX(auth.WithUser(ctx, u))
	sub.Update().SetPlan("pro").SaveX(auth.WithUser(ctx, u))
	if n := c.SubscriptionHistory.Query().CountX(auth.WithInternal(ctx)); n < 2 {
		t.Fatalf("subscription_history = %d, want >= 2", n)
	}
}
