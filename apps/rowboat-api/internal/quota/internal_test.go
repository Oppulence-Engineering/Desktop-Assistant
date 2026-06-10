package quota

import (
	"context"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func internalSetup(t *testing.T) (*ent.Client, context.Context, *ent.User) {
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
	d.Client.Subscription.Create().SetUser(u).SetSanctionedCredits(1_000_000).SaveX(bg)
	return d.Client, auth.WithUser(bg, u), u
}

// TestConsumedSinceAttributesToReservePeriod locks in the spend-cap boundary
// fix: a charge whose reserve falls BEFORE the window must not leak its (later,
// positive) terminal row into the window and hand the user free headroom.
func TestConsumedSinceAttributesToReservePeriod(t *testing.T) {
	client, ctx, u := internalSetup(t)

	ref := time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC) // arbitrary period start

	// Charge X straddles the boundary: reserved 1000 just before ref, settled
	// just after (actual cost 100 → terminal delta +900). It belongs to the PRIOR
	// period and must be fully excluded from [ref, ...].
	rx := uuid.New()
	client.CreditLedger.Create().SetUser(u).SetReason("llm_call.reserve").SetDelta(-1000).SetRequestID(rx).SetTs(ref.Add(-time.Minute)).SaveX(ctx)
	client.CreditLedger.Create().SetUser(u).SetReason("llm_call.final").SetDelta(900).SetRequestID(rx).SetTs(ref.Add(time.Minute)).SaveX(ctx)

	// Charge Y is reserved inside the window (-50, unfinalized → counts in full).
	ry := uuid.New()
	client.CreditLedger.Create().SetUser(u).SetReason("llm_call.reserve").SetDelta(-50).SetRequestID(ry).SetTs(ref.Add(2 * time.Minute)).SaveX(ctx)

	got, err := consumedSince(ctx, client, ref)
	if err != nil {
		t.Fatalf("consumedSince: %v", err)
	}
	if got != 50 {
		t.Fatalf("consumedSince = %d, want 50 (X's cross-boundary terminal must not leak in)", got)
	}
}

// TestReserveInProgressFlag locks in the concurrent-duplicate guard.
func TestReserveInProgressFlag(t *testing.T) {
	client, ctx, _ := internalSetup(t)
	g := New(client, zap.NewNop())
	rid := uuid.New()

	c1, err := g.Reserve(ctx, "llm_call", 40, rid, SpendLimits{})
	if err != nil {
		t.Fatalf("reserve 1: %v", err)
	}
	if c1.InProgress() {
		t.Fatal("the first (winning) reserve must not be in-progress")
	}

	// Duplicate while the original is unfinalized and recent → in progress.
	c2, err := g.Reserve(ctx, "llm_call", 40, rid, SpendLimits{})
	if err != nil {
		t.Fatalf("reserve 2: %v", err)
	}
	if !c2.InProgress() {
		t.Fatal("duplicate of an unfinalized, recent reserve must be in-progress")
	}

	// Once the original finalizes, a later duplicate is a finalized replay, not
	// in-progress — and must be flagged so handlers refuse to re-call the vendor.
	if err := c1.Settle(ctx, 25); err != nil {
		t.Fatalf("settle: %v", err)
	}
	c3, err := g.Reserve(ctx, "llm_call", 40, rid, SpendLimits{})
	if err != nil {
		t.Fatalf("reserve 3: %v", err)
	}
	if c3.InProgress() {
		t.Fatal("duplicate after the original finalized must not be in-progress")
	}
	if !c3.Finalized() {
		t.Fatal("duplicate after the original finalized must be flagged Finalized")
	}
}

// TestStaleUnfinalizedDuplicateMayProceed locks in the recovery path: when the
// original died mid-flight (old reserve, no terminal row), a retry proceeds.
func TestStaleUnfinalizedDuplicateMayProceed(t *testing.T) {
	client, ctx, u := internalSetup(t)
	g := New(client, zap.NewNop())
	rid := uuid.New()

	// Simulate a reserve from beyond the in-flight window with no terminal row.
	client.CreditLedger.Create().SetUser(u).SetReason("llm_call.reserve").SetDelta(-40).SetRequestID(rid).SetTs(time.Now().UTC().Add(-2 * inFlightWindow)).SaveX(ctx)

	c, err := g.Reserve(ctx, "llm_call", 40, rid, SpendLimits{})
	if err != nil {
		t.Fatalf("reserve: %v", err)
	}
	if c.InProgress() || c.Finalized() {
		t.Fatalf("stale unfinalized duplicate: InProgress=%v Finalized=%v, want false/false", c.InProgress(), c.Finalized())
	}
}
