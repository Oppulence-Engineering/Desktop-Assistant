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
	userCtx := auth.WithUser(bg, u)
	d.Client.Subscription.Create().SetUser(u).SetSanctionedCredits(100).SaveX(userCtx)
	return d.Client, userCtx, u
}

func TestReserveSettleHappyPath(t *testing.T) {
	client, ctx, _ := setup(t)
	g := quota.New(client, zap.NewNop())
	rid := uuid.New()

	charge, err := g.Reserve(ctx, "llm_call", 40, rid, quota.SpendLimits{})
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
	_, err := g.Reserve(ctx, "llm_call", 101, uuid.New(), quota.SpendLimits{})
	if !errors.Is(err, quota.ErrInsufficientCredits) {
		t.Fatalf("want ErrInsufficientCredits, got %v", err)
	}
}

func TestReserveRejectsInactiveSubscription(t *testing.T) {
	client, ctx, u := setup(t)
	client.Subscription.Update().
		SetStatus("past_due").
		ExecX(auth.WithUser(ctx, u))
	g := quota.New(client, zap.NewNop())
	_, err := g.Reserve(ctx, "llm_call", 1, uuid.New(), quota.SpendLimits{})
	if !errors.Is(err, quota.ErrSubscriptionNotActive) {
		t.Fatalf("want ErrSubscriptionNotActive, got %v", err)
	}
	if err := g.Preflight(ctx, 1, quota.SpendLimits{}); !errors.Is(err, quota.ErrSubscriptionNotActive) {
		t.Fatalf("preflight err = %v, want ErrSubscriptionNotActive", err)
	}
}

func TestRefundReturnsFullReservation(t *testing.T) {
	client, ctx, _ := setup(t)
	g := quota.New(client, zap.NewNop())
	charge, _ := g.Reserve(ctx, "llm_call", 40, uuid.New(), quota.SpendLimits{})
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
	if _, err := g.Reserve(ctx, "llm_call", 40, rid, quota.SpendLimits{}); err != nil {
		t.Fatalf("reserve 1: %v", err)
	}
	// Same request id → no double debit.
	if _, err := g.Reserve(ctx, "llm_call", 40, rid, quota.SpendLimits{}); err != nil {
		t.Fatalf("reserve 2: %v", err)
	}
	if avail, _ := credits.Available(ctx, client, 100); avail != 60 {
		t.Fatalf("idempotent reserve available = %d, want 60", avail)
	}
}

// TestDuplicateRequestCannotMintCredits guards the CRITICAL idempotency-key
// minting bug: reusing one request_id with a larger estimate, or driving both a
// settle and a refund for the same request, must never inflate the balance.
func TestDuplicateRequestCannotMintCredits(t *testing.T) {
	client, ctx, _ := setup(t)
	g := quota.New(client, zap.NewNop())
	rid := uuid.New()

	// First request reserves 40 and settles at actual 25 (refunds the 15 excess).
	chargeA, err := g.Reserve(ctx, "llm_call", 40, rid, quota.SpendLimits{})
	if err != nil {
		t.Fatalf("reserve A: %v", err)
	}
	if err := chargeA.Settle(ctx, 25); err != nil {
		t.Fatalf("settle A: %v", err)
	}
	if avail, _ := credits.Available(ctx, client, 100); avail != 75 {
		t.Fatalf("after settle A available = %d, want 75", avail)
	}

	// A duplicate request reuses the SAME request_id but claims a larger estimate
	// (70, still within the 75 available balance so it passes the balance check
	// and reaches the idempotent branch). The old bug returned reserved=70 and
	// re-released it on refund; the fix reads back the original 40.
	chargeB, err := g.Reserve(ctx, "llm_call", 70, rid, quota.SpendLimits{})
	if err != nil {
		t.Fatalf("reserve B (idempotent): %v", err)
	}
	if got := chargeB.Reserved(); got != 40 {
		t.Fatalf("idempotent retry reserved = %d, want 40 (original), not the inflated estimate", got)
	}
	if !chargeB.Finalized() {
		t.Fatalf("replay of a settled request must report Finalized so handlers refuse to re-call the vendor")
	}
	// Refunding the duplicate must be a no-op: the charge was already settled.
	if err := chargeB.Refund(ctx); err != nil {
		t.Fatalf("refund B: %v", err)
	}
	if avail, _ := credits.Available(ctx, client, 100); avail != 75 {
		t.Fatalf("after duplicate refund available = %d, want 75 (no minting)", avail)
	}
}

// TestFlatRateSettleBlocksDuplicateRefund covers the diff==0 path used by
// flat-rate charges (voice/search): a settle where actual==reserved must still
// record a terminal marker so a duplicate retry cannot refund the reservation.
func TestFlatRateSettleBlocksDuplicateRefund(t *testing.T) {
	client, ctx, _ := setup(t)
	g := quota.New(client, zap.NewNop())
	rid := uuid.New()

	chargeA, err := g.Reserve(ctx, "voice_tts", 30, rid, quota.SpendLimits{})
	if err != nil {
		t.Fatalf("reserve A: %v", err)
	}
	// Flat-rate: actual == reserved, so diff is zero.
	if err := chargeA.Settle(ctx, 30); err != nil {
		t.Fatalf("settle A: %v", err)
	}
	if avail, _ := credits.Available(ctx, client, 100); avail != 70 {
		t.Fatalf("after flat settle available = %d, want 70", avail)
	}

	// Duplicate retry (same request_id) that fails and refunds must be a no-op:
	// the charge was already settled.
	chargeB, err := g.Reserve(ctx, "voice_tts", 30, rid, quota.SpendLimits{})
	if err != nil {
		t.Fatalf("reserve B (idempotent): %v", err)
	}
	if err := chargeB.Refund(ctx); err != nil {
		t.Fatalf("refund B: %v", err)
	}
	if avail, _ := credits.Available(ctx, client, 100); avail != 70 {
		t.Fatalf("after duplicate refund available = %d, want 70 (no minting)", avail)
	}
}

// TestRefundThenSettleIsMutuallyExclusive verifies the terminal phase is atomic
// in BOTH orders: once a charge is refunded, a duplicate retry that settles must
// be a no-op (and vice versa), so the reservation is never released twice.
func TestRefundThenSettleIsMutuallyExclusive(t *testing.T) {
	client, ctx, _ := setup(t)
	g := quota.New(client, zap.NewNop())
	rid := uuid.New()

	// First attempt reserves 40 and fails → full refund. Net consumption 0.
	chargeA, err := g.Reserve(ctx, "llm_call", 40, rid, quota.SpendLimits{})
	if err != nil {
		t.Fatalf("reserve A: %v", err)
	}
	if err := chargeA.Refund(ctx); err != nil {
		t.Fatalf("refund A: %v", err)
	}
	if avail, _ := credits.Available(ctx, client, 100); avail != 100 {
		t.Fatalf("after refund A available = %d, want 100", avail)
	}

	// A duplicate retry (same request_id) that succeeds must NOT settle on top of
	// the refund (which would leave the user charged 0 AND credited the diff).
	chargeB, err := g.Reserve(ctx, "llm_call", 40, rid, quota.SpendLimits{})
	if err != nil {
		t.Fatalf("reserve B (idempotent): %v", err)
	}
	if err := chargeB.Settle(ctx, 25); err != nil {
		t.Fatalf("settle B: %v", err)
	}
	if avail, _ := credits.Available(ctx, client, 100); avail != 100 {
		t.Fatalf("after duplicate settle available = %d, want 100 (terminal already refunded)", avail)
	}
}

// TestFinalizedReplayIsFlagged guards the free-inference replay hole: once a
// request settles, a sequential replay of the same request_id must come back
// Finalized (not InProgress, not clear-to-proceed) so handlers reject it
// instead of re-calling the vendor for a charge whose accounting writes all
// no-op.
func TestFinalizedReplayIsFlagged(t *testing.T) {
	client, ctx, _ := setup(t)
	g := quota.New(client, zap.NewNop())
	rid := uuid.New()

	chargeA, err := g.Reserve(ctx, "llm_call", 40, rid, quota.SpendLimits{})
	if err != nil {
		t.Fatalf("reserve A: %v", err)
	}
	if chargeA.Finalized() || chargeA.InProgress() {
		t.Fatalf("fresh reserve must be neither finalized nor in progress")
	}
	if err := chargeA.Settle(ctx, 40); err != nil {
		t.Fatalf("settle A: %v", err)
	}

	chargeB, err := g.Reserve(ctx, "llm_call", 40, rid, quota.SpendLimits{})
	if err != nil {
		t.Fatalf("reserve B (replay): %v", err)
	}
	if !chargeB.Finalized() {
		t.Fatalf("replay after settle must be Finalized")
	}
	if chargeB.InProgress() {
		t.Fatalf("replay after settle must not be InProgress")
	}

	// An unfinalized duplicate within the in-flight window is InProgress.
	rid2 := uuid.New()
	if _, err := g.Reserve(ctx, "llm_call", 10, rid2, quota.SpendLimits{}); err != nil {
		t.Fatalf("reserve C: %v", err)
	}
	chargeD, err := g.Reserve(ctx, "llm_call", 10, rid2, quota.SpendLimits{})
	if err != nil {
		t.Fatalf("reserve D (concurrent dup): %v", err)
	}
	if !chargeD.InProgress() || chargeD.Finalized() {
		t.Fatalf("concurrent duplicate: InProgress=%v Finalized=%v, want true/false", chargeD.InProgress(), chargeD.Finalized())
	}
}

// TestSpendLimitsEnforcedInReserve verifies the caps are checked inside the
// reservation transaction (the reserve itself counts toward the cap) and that
// a cap rejection leaves no debit behind.
func TestSpendLimitsEnforcedInReserve(t *testing.T) {
	client, ctx, _ := setup(t)
	g := quota.New(client, zap.NewNop())
	limits := quota.SpendLimits{Daily: 50}

	if _, err := g.Reserve(ctx, "llm_call", 30, uuid.New(), limits); err != nil {
		t.Fatalf("reserve within cap: %v", err)
	}
	_, err := g.Reserve(ctx, "llm_call", 30, uuid.New(), limits)
	if !errors.Is(err, quota.ErrDailyLimitExceeded) {
		t.Fatalf("want ErrDailyLimitExceeded, got %v", err)
	}
	// The rejected reservation must have been rolled back: 100 - 30 = 70.
	if avail, _ := credits.Available(ctx, client, 100); avail != 70 {
		t.Fatalf("after cap rejection available = %d, want 70 (rejected reserve rolled back)", avail)
	}
}

// --- op-scoped budgets (RFC 039) ---------------------------------------------

// fundedSetup is setup() with a grant large enough to exercise caps rather than
// the balance check.
func fundedSetup(t *testing.T) (*ent.Client, context.Context) {
	t.Helper()
	client, ctx, _ := setup(t)
	client.Subscription.Update().SetSanctionedCredits(10_000_000).SaveX(ctx)
	return client, ctx
}

// An op-scoped budget exists so one workload cannot be starved by another's
// spending. Cloud research is background work sold as a fixed number of
// monitored accounts; a shared cap silently converts that budget into whatever
// the foreground happened to spend today, and the user is asleep for both
// halves of that.
func TestOpBudgetIsRingFenced(t *testing.T) {
	client, ctx := fundedSetup(t)
	g := quota.New(client, zap.NewNop())
	limits := quota.SpendLimits{
		Daily: 1_000_000, Monthly: 1_000_000,
		OpDaily: 200, OpMonthly: 200,
	}

	first, err := g.Reserve(ctx, "parallel_task", 200, uuid.New(), limits)
	if err != nil {
		t.Fatalf("first research reserve: %v", err)
	}
	if err := first.Settle(ctx, 200); err != nil {
		t.Fatalf("settle: %v", err)
	}

	if _, err := g.Reserve(ctx, "parallel_task", 200, uuid.New(), limits); !errors.Is(err, quota.ErrDailyLimitExceeded) {
		t.Fatalf("research past its op budget: want ErrDailyLimitExceeded, got %v", err)
	}

	// The shared budget is barely touched and still admits other work. The ring
	// fence is one-directional, which is the entire point.
	other, err := g.Reserve(ctx, "llm_call", 200, uuid.New(), limits)
	if err != nil {
		t.Fatalf("unrelated op refused by another op's budget: %v", err)
	}
	if err := other.Settle(ctx, 200); err != nil {
		t.Fatalf("settle: %v", err)
	}
}

// The ring fence must not become an escape hatch: the shared cap still binds.
func TestSharedBudgetStillBindsWithOpBudget(t *testing.T) {
	client, ctx := fundedSetup(t)
	g := quota.New(client, zap.NewNop())
	limits := quota.SpendLimits{
		Daily: 300, Monthly: 300,
		OpDaily: 1_000_000, OpMonthly: 1_000_000,
	}

	spent, err := g.Reserve(ctx, "llm_call", 300, uuid.New(), limits)
	if err != nil {
		t.Fatalf("first reserve: %v", err)
	}
	if err := spent.Settle(ctx, 300); err != nil {
		t.Fatalf("settle: %v", err)
	}
	if _, err := g.Reserve(ctx, "parallel_task", 100, uuid.New(), limits); !errors.Is(err, quota.ErrDailyLimitExceeded) {
		t.Fatalf("shared cap should still refuse: got %v", err)
	}
}

// A refunded call must not consume the op budget: the whole point of the
// reserve/refund pair is that a failed vendor call costs nothing.
func TestRefundedCallDoesNotConsumeOpBudget(t *testing.T) {
	client, ctx := fundedSetup(t)
	g := quota.New(client, zap.NewNop())
	limits := quota.SpendLimits{OpDaily: 200, OpMonthly: 200}

	failed, err := g.Reserve(ctx, "parallel_task", 200, uuid.New(), limits)
	if err != nil {
		t.Fatalf("reserve: %v", err)
	}
	if err := failed.Refund(ctx); err != nil {
		t.Fatalf("refund: %v", err)
	}
	if _, err := g.Reserve(ctx, "parallel_task", 200, uuid.New(), limits); err != nil {
		t.Fatalf("a refunded call consumed the op budget: %v", err)
	}
}

// Zero op limits must leave every existing caller untouched.
func TestZeroOpBudgetIsInert(t *testing.T) {
	client, ctx := fundedSetup(t)
	g := quota.New(client, zap.NewNop())
	limits := quota.SpendLimits{Daily: 1_000_000, Monthly: 1_000_000}

	for i := 0; i < 3; i++ {
		charge, err := g.Reserve(ctx, "parallel_task", 1000, uuid.New(), limits)
		if err != nil {
			t.Fatalf("reserve %d with no op cap: %v", i, err)
		}
		if err := charge.Settle(ctx, 1000); err != nil {
			t.Fatalf("settle %d: %v", i, err)
		}
	}
}

// The op budget must count what was actually SPENT, not what was reserved.
//
// A charge reserves an estimate and settles the difference back. If the op
// accounting only summed reservations, an over-estimating caller would burn its
// budget on money it never spent — and the ring fence would be tighter than the
// number the plan advertises.
func TestOpBudgetCountsActualNotReserved(t *testing.T) {
	client, ctx := fundedSetup(t)
	g := quota.New(client, zap.NewNop())
	limits := quota.SpendLimits{OpDaily: 200, OpMonthly: 200}

	// Reserve 250 (over the cap is fine — the cap is checked against consumption,
	// and this reservation is refunded down to 50).
	over, err := g.Reserve(ctx, "parallel_task", 150, uuid.New(), limits)
	if err != nil {
		t.Fatalf("reserve: %v", err)
	}
	if err := over.Settle(ctx, 50); err != nil {
		t.Fatalf("settle: %v", err)
	}

	// 50 spent against a 200 budget leaves room for another 150.
	next, err := g.Reserve(ctx, "parallel_task", 150, uuid.New(), limits)
	if err != nil {
		t.Fatalf("op budget counted the reservation rather than the settlement: %v", err)
	}
	if err := next.Settle(ctx, 150); err != nil {
		t.Fatalf("settle: %v", err)
	}

	// Now 200 of 200 is spent; the next call is refused.
	if _, err := g.Reserve(ctx, "parallel_task", 10, uuid.New(), limits); !errors.Is(err, quota.ErrDailyLimitExceeded) {
		t.Fatalf("want ErrDailyLimitExceeded once the budget is spent, got %v", err)
	}
}
