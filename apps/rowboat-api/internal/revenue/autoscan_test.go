package revenue

import (
	"context"
	"fmt"
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

func TestAutoScannerFiltersDueUsersBeforeCycleLimit(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 2, 10, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	f.svc.SetSweeper(&fakeSweeper{email: selfAddr})

	users := []*ent.User{f.user}
	for i := 1; i < 3; i++ {
		users = append(users, newUser(t, f.client, fmt.Sprintf("due-%d@example.com", i), fmt.Sprintf("due_%d", i)))
	}
	for i, u := range users {
		uctx := auth.WithUser(context.Background(), u)
		f.client.OAuthConnection.Create().
			SetUser(u).
			SetProvider("google").
			SetRefreshTokenEncrypted([]byte("x")).
			SetScopes([]string{scopeGmailReadonly}).
			SetExternalAccountID(fmt.Sprintf("due-%d@gmail.com", i)).
			SaveX(uctx)
		if i < 2 {
			workspace, err := f.svc.CurrentWorkspace(uctx, u)
			if err != nil {
				t.Fatal(err)
			}
			f.client.RevenueLeakScan.Create().
				SetWorkspace(workspace).
				SetUser(u).
				SetStatus("completed").
				SetStartedAt(now.Add(-time.Hour)).
				SetCompletedAt(now.Add(-59 * time.Minute)).
				SaveX(uctx)
		}
	}

	scanner := NewAutoScanner(f.svc, AutoScanConfig{MinPerUser: 24 * time.Hour, MaxPerCycle: 2}, zap.NewNop())
	scanner.sweep(context.Background())

	if count := users[2].QueryRevenueLeakScans().CountX(auth.WithUser(context.Background(), users[2])); count != 1 {
		t.Fatalf("later due account was starved behind two recent accounts: scans=%d", count)
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

func TestAutoScannerRecoversDueCommitmentsWithoutGoogleConnection(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel, _ := recoveryCommitment(t, f, now)
	scanner := NewAutoScanner(f.svc, AutoScanConfig{MaxPerCycle: 50}, zap.NewNop())
	scanner.sweep(context.Background())
	evaluations, err := recoveryEvaluationsFor(f.ctx, f.client, rel)
	if err != nil || len(evaluations) != 1 {
		t.Fatalf("due commitment was not recovered without Google: %#v err=%v", evaluations, err)
	}
}
