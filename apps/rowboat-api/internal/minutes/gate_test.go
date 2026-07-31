package minutes_test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/minutes"
	"go.uber.org/zap"
)

func setup(t *testing.T) (*ent.Client, context.Context) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	bg := context.Background()
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(bg)
	return d.Client, auth.WithUser(bg, u)
}

// allowance: free plan gets 600s/month; paid is unlimited.
func allowance(plan string) int {
	if plan == "pro" {
		return -1
	}
	return 600
}

func TestRemainingDefaultsToFullAllowance(t *testing.T) {
	client, ctx := setup(t)
	g := minutes.New(client, zap.NewNop(), allowance)
	rem, err := g.Remaining(ctx, "free")
	if err != nil {
		t.Fatalf("remaining: %v", err)
	}
	if rem != 600 {
		t.Fatalf("remaining = %d, want 600", rem)
	}
}

func TestReserveSettleAccounting(t *testing.T) {
	client, ctx := setup(t)
	g := minutes.New(client, zap.NewNop(), allowance)

	charge, err := g.Reserve(ctx, "free", 300)
	if err != nil {
		t.Fatalf("reserve: %v", err)
	}
	if rem, _ := g.Remaining(ctx, "free"); rem != 300 {
		t.Fatalf("after reserve remaining = %d, want 300", rem)
	}
	// Actual was 120s → settle counts 120 used, releases the rest of the reservation.
	if err := charge.Settle(ctx, 120); err != nil {
		t.Fatalf("settle: %v", err)
	}
	if rem, _ := g.Remaining(ctx, "free"); rem != 480 {
		t.Fatalf("after settle remaining = %d, want 480", rem)
	}
}

func TestRefundReleasesReservation(t *testing.T) {
	client, ctx := setup(t)
	g := minutes.New(client, zap.NewNop(), allowance)

	charge, err := g.Reserve(ctx, "free", 200)
	if err != nil {
		t.Fatalf("reserve: %v", err)
	}
	if err := charge.Refund(ctx); err != nil {
		t.Fatalf("refund: %v", err)
	}
	if rem, _ := g.Remaining(ctx, "free"); rem != 600 {
		t.Fatalf("after refund remaining = %d, want 600", rem)
	}
}

func TestReserveExhaustionIsRejected(t *testing.T) {
	client, ctx := setup(t)
	g := minutes.New(client, zap.NewNop(), allowance)

	if _, err := g.Reserve(ctx, "free", 500); err != nil {
		t.Fatalf("first reserve: %v", err)
	}
	// 500 + 200 > 600 → exhausted.
	_, err := g.Reserve(ctx, "free", 200)
	if !errors.Is(err, minutes.ErrMinutesExhausted) {
		t.Fatalf("second reserve err = %v, want ErrMinutesExhausted", err)
	}
}

func TestConcurrentReservationsCannotSpendSameAllowance(t *testing.T) {
	client, ctx := setup(t)
	g := minutes.New(client, zap.NewNop(), allowance)
	// Materialize the period row before the race so this test isolates the
	// atomic balance predicate on the reservation UPDATE.
	if _, err := g.Reserve(ctx, "free", 0); err != nil {
		t.Fatalf("materialize usage: %v", err)
	}

	start := make(chan struct{})
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := g.Reserve(ctx, "free", 600)
			errs <- err
		}()
	}
	close(start)
	wg.Wait()
	close(errs)

	var succeeded, exhausted int
	for err := range errs {
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, minutes.ErrMinutesExhausted):
			exhausted++
		default:
			t.Fatalf("unexpected reserve error: %v", err)
		}
	}
	if succeeded != 1 || exhausted != 1 {
		t.Fatalf("concurrent reservations: succeeded=%d exhausted=%d", succeeded, exhausted)
	}
	if remaining, err := g.Remaining(ctx, "free"); err != nil || remaining != 0 {
		t.Fatalf("remaining=%d err=%v, want 0", remaining, err)
	}
}

func TestRemainingIsScopedPerUser(t *testing.T) {
	client, ctx1 := setup(t)
	g := minutes.New(client, zap.NewNop(), allowance)

	// user_1 reserves 300s of their allowance.
	if _, err := g.Reserve(ctx1, "free", 300); err != nil {
		t.Fatalf("reserve: %v", err)
	}

	// A different user must see the FULL allowance — never user_1's usage. This is
	// the tenant-isolation guarantee (the per-user query interceptor), and the
	// regression test for the IDOR where MeetingMinuteUsage queries were unscoped.
	u2 := client.User.Create().SetEmail("b@x.co").SetWorkosUserID("user_2").SaveX(context.Background())
	ctx2 := auth.WithUser(context.Background(), u2)
	rem2, err := g.Remaining(ctx2, "free")
	if err != nil {
		t.Fatalf("remaining (user_2): %v", err)
	}
	if rem2 != 600 {
		t.Fatalf("cross-tenant leak: user_2 remaining = %d, want 600", rem2)
	}
}

func TestPaidPlanIsUnlimited(t *testing.T) {
	client, ctx := setup(t)
	g := minutes.New(client, zap.NewNop(), allowance)

	if !g.IsUnlimited("pro") {
		t.Fatal("pro should be unlimited")
	}
	// Reserve on an unlimited plan is a no-op that never errors.
	charge, err := g.Reserve(ctx, "pro", 1_000_000)
	if err != nil {
		t.Fatalf("unlimited reserve: %v", err)
	}
	if err := charge.Settle(ctx, 1_000_000); err != nil {
		t.Fatalf("unlimited settle: %v", err)
	}
	rem, _ := g.Remaining(ctx, "pro")
	if rem <= 600 {
		t.Fatalf("unlimited remaining = %d, want large sentinel", rem)
	}
}
