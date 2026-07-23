package revenue

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
)

// recordingSweeper captures the `since` cursor it is called with.
type recordingSweeper struct {
	threads   [][]googleapi.GmailThreadMessage
	email     string
	calls     int
	lastSince *time.Time
}

func (r *recordingSweeper) SweepThreads(
	_ context.Context, _ uuid.UUID, _ int, _ int, since *time.Time,
) ([][]googleapi.GmailThreadMessage, string, error) {
	r.calls++
	r.lastSince = since
	return r.threads, r.email, nil
}

func waitScan(t *testing.T, f *fixture, id uuid.UUID) *ent.RevenueLeakScan {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		got, err := f.svc.GetScan(f.ctx, id)
		if err != nil {
			t.Fatalf("get scan: %v", err)
		}
		if got.Status == "completed" || got.Status == "failed" {
			return got
		}
		if time.Now().After(deadline) {
			t.Fatalf("scan did not finish: %s", got.Status)
		}
		time.Sleep(15 * time.Millisecond)
	}
}

// The first scan reads the full window (since=nil); the second scan is
// incremental and passes the first scan's freshness cursor.
func TestIncrementalScanUsesFreshnessCursor(t *testing.T) {
	f := newFixture(t)
	sw := &recordingSweeper{
		threads: scanFixtureThreads(),
		email:   selfAddr,
	}
	f.svc.SetSweeper(sw)

	scan1, err := f.svc.StartScan(f.ctx, f.user, 90)
	if err != nil {
		t.Fatalf("scan 1: %v", err)
	}
	done1 := waitScan(t, f, scan1.ID)
	if sw.lastSince != nil {
		t.Fatalf("first scan must read the full window (since=nil), got %v", sw.lastSince)
	}
	if done1.SourceFreshnessAt == nil {
		t.Fatal("first scan should record a freshness cursor")
	}

	scan2, err := f.svc.StartScan(f.ctx, f.user, 90)
	if err != nil {
		t.Fatalf("scan 2: %v", err)
	}
	waitScan(t, f, scan2.ID)
	if sw.lastSince == nil {
		t.Fatal("second scan must be incremental (since set to the prior cursor)")
	}
	if !sw.lastSince.Equal(*done1.SourceFreshnessAt) {
		t.Fatalf("cursor mismatch: since=%v want=%v", sw.lastSince, done1.SourceFreshnessAt)
	}
	if sw.calls != 2 {
		t.Fatalf("sweeper should have run twice, got %d", sw.calls)
	}
}

// The auto-scanner starts a scan for a Google-connected user, and honors the
// per-user minimum interval on the next sweep.
func TestAutoScannerStartsAndRespectsInterval(t *testing.T) {
	f := newFixture(t)
	f.svc.SetSweeper(&fakeSweeper{threads: nil, email: selfAddr})

	// The fixture user needs a Google connection to be a candidate.
	f.client.OAuthConnection.Create().
		SetUser(f.user).
		SetProvider("google").
		SetRefreshTokenEncrypted([]byte("x")).
		SetScopes([]string{scopeGmailReadonly}).
		SetExternalAccountID("me@gmail.com").
		SaveX(auth.WithUser(context.Background(), f.user))

	scanner := NewAutoScanner(f.svc, AutoScanConfig{
		Interval:    time.Hour,
		MinPerUser:  24 * time.Hour,
		MaxPerCycle: 50,
	}, zap.NewNop())

	scanner.sweep(context.Background())
	countAfterFirst := f.client.RevenueLeakScan.Query().CountX(f.ctx)
	if countAfterFirst != 1 {
		t.Fatalf("auto-scan should have started one scan, got %d", countAfterFirst)
	}

	// A second immediate sweep must NOT start another scan (min interval).
	scanner.sweep(context.Background())
	countAfterSecond := f.client.RevenueLeakScan.Query().CountX(f.ctx)
	if countAfterSecond != 1 {
		t.Fatalf("min-interval must suppress a second scan, got %d", countAfterSecond)
	}
}

// A user with no Google connection is not a candidate.
func TestAutoScannerSkipsUnconnectedUser(t *testing.T) {
	f := newFixture(t)
	f.svc.SetSweeper(&fakeSweeper{email: selfAddr})
	scanner := NewAutoScanner(f.svc, AutoScanConfig{}, zap.NewNop())
	scanner.sweep(context.Background())
	if n := f.client.RevenueLeakScan.Query().CountX(f.ctx); n != 0 {
		t.Fatalf("no Google connection should mean no scan, got %d", n)
	}
}
