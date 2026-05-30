package quota_test

import (
	"context"
	"errors"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/credits"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func setup(t *testing.T) (*ent.Client, context.Context, *ent.User) {
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
	d.Client.Subscription.Create().SetUser(u).SetSanctionedCredits(100).SaveX(bg)
	return d.Client, auth.WithUser(bg, u), u
}

func TestReserveSettleHappyPath(t *testing.T) {
	client, ctx, _ := setup(t)
	g := quota.New(client, zap.NewNop())
	rid := uuid.New()

	charge, err := g.Reserve(ctx, "llm_call", 40, rid)
	if err != nil {
		t.Fatalf("reserve: %v", err)
	}
	// After reserving 40 of 100, available is 60.
	if avail, _ := credits.Available(ctx, client, 100); avail != 60 {
		t.Fatalf("after reserve available = %d, want 60", avail)
	}
	// Actual was only 25 → settle refunds 15, leaving 75.
	if err := charge.Settle(ctx, 25); err != nil {
		t.Fatalf("settle: %v", err)
	}
	if avail, _ := credits.Available(ctx, client, 100); avail != 75 {
		t.Fatalf("after settle available = %d, want 75", avail)
	}
}

func TestReserveInsufficient(t *testing.T) {
	client, ctx, _ := setup(t)
	g := quota.New(client, zap.NewNop())
	_, err := g.Reserve(ctx, "llm_call", 101, uuid.New())
	if !errors.Is(err, quota.ErrInsufficientCredits) {
		t.Fatalf("want ErrInsufficientCredits, got %v", err)
	}
}

func TestRefundReturnsFullReservation(t *testing.T) {
	client, ctx, _ := setup(t)
	g := quota.New(client, zap.NewNop())
	charge, _ := g.Reserve(ctx, "llm_call", 40, uuid.New())
	if err := charge.Refund(ctx); err != nil {
		t.Fatalf("refund: %v", err)
	}
	if avail, _ := credits.Available(ctx, client, 100); avail != 100 {
		t.Fatalf("after refund available = %d, want 100", avail)
	}
}

func TestReserveIsIdempotent(t *testing.T) {
	client, ctx, _ := setup(t)
	g := quota.New(client, zap.NewNop())
	rid := uuid.New()
	if _, err := g.Reserve(ctx, "llm_call", 40, rid); err != nil {
		t.Fatalf("reserve 1: %v", err)
	}
	// Same request id → no double debit.
	if _, err := g.Reserve(ctx, "llm_call", 40, rid); err != nil {
		t.Fatalf("reserve 2: %v", err)
	}
	if avail, _ := credits.Available(ctx, client, 100); avail != 60 {
		t.Fatalf("idempotent reserve available = %d, want 60", avail)
	}
}
