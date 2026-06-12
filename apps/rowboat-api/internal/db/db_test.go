package db_test

import (
	"context"
	"errors"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func openTest(t *testing.T) *db.DB {
	t.Helper()
	cfg := appconfig.Config{
		// Unique shared in-memory db per test.
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}
	d, err := db.Open(context.Background(), cfg, zap.NewNop())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d
}

func seedUser(t *testing.T, c *ent.Client, email, wid string) *ent.User {
	t.Helper()
	ctx := context.Background()
	u := c.User.Create().SetEmail(email).SetWorkosUserID(wid).SaveX(ctx)
	c.Subscription.Create().SetUser(u).SaveX(ctx)
	return u
}

func TestTenantScoping(t *testing.T) {
	d := openTest(t)
	c := d.Client
	ctx := context.Background()

	u1 := seedUser(t, c, "a@x.co", "user_1")
	u2 := seedUser(t, c, "b@x.co", "user_2")

	c.CreditLedger.Create().SetUser(u1).SetDelta(-5).SetReason("llm_call").SetRequestID(uuid.New()).SaveX(ctx)
	c.CreditLedger.Create().SetUser(u1).SetDelta(-3).SetReason("llm_call").SetRequestID(uuid.New()).SaveX(ctx)
	c.CreditLedger.Create().SetUser(u2).SetDelta(-7).SetReason("llm_call").SetRequestID(uuid.New()).SaveX(ctx)

	// No viewer in context → deny.
	if _, err := c.CreditLedger.Query().All(ctx); !errors.Is(err, db.ErrNoViewer) {
		t.Fatalf("expected ErrNoViewer for unscoped query, got %v", err)
	}

	// Viewer u1 → only u1's rows.
	ctx1 := auth.WithUser(ctx, u1)
	n1 := c.CreditLedger.Query().CountX(ctx1)
	if n1 != 2 {
		t.Fatalf("u1 should see 2 ledger rows, saw %d", n1)
	}

	// Viewer u2 → only u2's row.
	ctx2 := auth.WithUser(ctx, u2)
	n2 := c.CreditLedger.Query().CountX(ctx2)
	if n2 != 1 {
		t.Fatalf("u2 should see 1 ledger row, saw %d", n2)
	}

	// Internal caller → all rows across tenants.
	ctxInt := auth.WithInternal(ctx)
	nAll := c.CreditLedger.Query().CountX(ctxInt)
	if nAll != 3 {
		t.Fatalf("internal caller should see 3 ledger rows, saw %d", nAll)
	}
}

// TestInternalWithUserStaysScoped reproduces the API-worker LLM path: a
// Temporal activity marks the context internal, then the gateway attaches the
// run's owner via auth.WithUser before quota reads. The user must win over the
// internal flag — with two tenants in the DB, an unscoped Subscription.Only()
// would fail NotSingular (and worse, silently read the wrong tenant when only
// one row exists).
func TestInternalWithUserStaysScoped(t *testing.T) {
	d := openTest(t)
	c := d.Client
	ctx := context.Background()

	u1 := seedUser(t, c, "a@x.co", "user_1")
	seedUser(t, c, "b@x.co", "user_2")

	ctxWorker := auth.WithUser(auth.WithInternal(ctx), u1)
	sub, err := c.Subscription.Query().Only(ctxWorker)
	if err != nil {
		t.Fatalf("internal+user Subscription.Only should be scoped to the user, got %v", err)
	}
	owner := sub.QueryUser().OnlyX(auth.WithInternal(ctx))
	if owner.ID != u1.ID {
		t.Fatalf("internal+user query returned another tenant's subscription (owner %s, want %s)", owner.ID, u1.ID)
	}
}

func TestAppendOnlyLedger(t *testing.T) {
	d := openTest(t)
	c := d.Client
	ctx := context.Background()
	u := seedUser(t, c, "a@x.co", "user_1")
	ctxU := auth.WithUser(ctx, u)

	row := c.CreditLedger.Create().SetUser(u).SetDelta(-5).SetReason("llm_call").SetRequestID(uuid.New()).SaveX(ctx)

	if err := c.CreditLedger.UpdateOne(row).SetDelta(99).Exec(ctxU); err == nil {
		t.Fatal("expected update on credit ledger to be rejected (append-only)")
	}
	if err := c.CreditLedger.DeleteOne(row).Exec(ctxU); err == nil {
		t.Fatal("expected delete on credit ledger to be rejected (append-only)")
	}
}

func TestIdempotentLedgerKey(t *testing.T) {
	d := openTest(t)
	c := d.Client
	ctx := context.Background()
	u := seedUser(t, c, "a@x.co", "user_1")

	rid := uuid.New()
	c.CreditLedger.Create().SetUser(u).SetDelta(-5).SetReason("llm_call_reserve").SetRequestID(rid).SaveX(ctx)

	// Same (request_id, reason) violates the unique index → retry-safe.
	if err := c.CreditLedger.Create().SetUser(u).SetDelta(-5).SetReason("llm_call_reserve").SetRequestID(rid).Exec(ctx); err == nil {
		t.Fatal("expected unique-violation on duplicate (request_id, reason)")
	}

	// Same request_id, different reason (a later phase) is allowed.
	c.CreditLedger.Create().SetUser(u).SetDelta(2).SetReason("refund").SetRequestID(rid).SaveX(ctx)
}
