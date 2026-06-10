package quota

import (
	"context"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/credits"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func reaperSetup(t *testing.T) (*ent.Client, *ent.User, context.Context) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	bg := auth.WithInternal(context.Background())
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(bg)
	d.Client.Subscription.Create().SetUser(u).SetSanctionedCredits(10000).SaveX(bg)
	return d.Client, u, bg
}

func ledgerRow(ctx context.Context, t *testing.T, client *ent.Client, u *ent.User, delta int, reason string, rid uuid.UUID, age time.Duration) {
	t.Helper()
	client.CreditLedger.Create().
		SetUser(u).SetDelta(delta).SetReason(reason).SetRequestID(rid).
		SetTs(time.Now().UTC().Add(-age)).
		ExecX(ctx)
}

// TestReapOrphanedReservations: an old reserve row with no terminal row is
// refunded; settled charges, young reserves, and already-reaped rows are not.
func TestReapOrphanedReservations(t *testing.T) {
	client, u, ctx := reaperSetup(t)

	orphan := uuid.New()
	settled := uuid.New()
	young := uuid.New()
	ledgerRow(ctx, t, client, u, -500, "runtime_llm.reserve", orphan, 2*time.Hour)
	ledgerRow(ctx, t, client, u, -300, "runtime_llm.reserve", settled, 2*time.Hour)
	ledgerRow(ctx, t, client, u, 250, "runtime_llm.final", settled, 2*time.Hour) // settle: refund of unused estimate
	ledgerRow(ctx, t, client, u, -400, "runtime_llm.reserve", young, 5*time.Minute)

	n, err := ReapOrphanedReservations(ctx, client, zap.NewNop(), time.Hour)
	if err != nil {
		t.Fatalf("reap: %v", err)
	}
	if n != 1 {
		t.Fatalf("reaped = %d, want 1 (only the orphan)", n)
	}

	// The orphan's full estimate came back: 10000 -500 -300 +250 -400 +500.
	avail, err := credits.Available(ctx, client, 10000)
	if err != nil {
		t.Fatalf("available: %v", err)
	}
	if avail != 9550 {
		t.Fatalf("available = %d, want 9550", avail)
	}

	// Idempotent: a second sweep finds nothing.
	if n, _ := ReapOrphanedReservations(ctx, client, zap.NewNop(), time.Hour); n != 0 {
		t.Fatalf("second sweep reaped %d, want 0", n)
	}

	// A late settle after the reap is dropped by the unique index (charge closed).
	err = client.CreditLedger.Create().
		SetUser(u).SetDelta(100).SetReason("runtime_llm.final").SetRequestID(orphan).
		SetTs(time.Now().UTC()).
		Exec(ctx)
	if !ent.IsConstraintError(err) {
		t.Fatalf("late settle err = %v, want unique-constraint rejection", err)
	}
}
