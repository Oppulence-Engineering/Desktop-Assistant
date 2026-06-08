package minutes_test

import (
	"context"
	"errors"
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
