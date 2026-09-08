package revenue

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailthread"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
)

// fakeMailSyncer scripts a history walk.
type fakeMailSyncer struct {
	threads    [][]googleapi.GmailThreadMessage
	email      string
	latest     string
	err        error
	lastCursor string
	syncCalls  int
}

func (f *fakeMailSyncer) SyncHistory(_ context.Context, _ uuid.UUID, start string) ([][]googleapi.GmailThreadMessage, string, string, error) {
	f.syncCalls++
	f.lastCursor = start
	if f.err != nil {
		return nil, f.email, "", f.err
	}
	return f.threads, f.email, f.latest, nil
}

func workspaceCursor(t *testing.T, f *fixture) string {
	t.Helper()
	ws := f.client.RevenueWorkspace.Query().
		Where(revenueworkspace.HasUserWith(user.IDEQ(f.user.ID))).OnlyX(f.ctx)
	return ws.MailHistoryID
}

// The first push bootstraps the cursor without walking history.
func TestPushSyncBootstraps(t *testing.T) {
	f := newFixture(t)
	sync := &fakeMailSyncer{email: selfAddr}
	f.svc.SetMailSyncer(sync)

	if err := f.svc.SyncMailFromPush(f.ctx, f.user, 1000); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if sync.syncCalls != 0 {
		t.Fatalf("first push must not walk history, calls=%d", sync.syncCalls)
	}
	if got := workspaceCursor(t, f); got != "1000" {
		t.Fatalf("cursor = %q, want 1000", got)
	}
}

// A subsequent push walks history from the cursor, indexes threads, advances.
func TestPushSyncIndexesAndAdvances(t *testing.T) {
	f := newFixture(t)
	sync := &fakeMailSyncer{threads: scanFixtureThreads(), email: selfAddr, latest: "2000"}
	f.svc.SetMailSyncer(sync)

	// Bootstrap the cursor, then a real push.
	if err := f.svc.SyncMailFromPush(f.ctx, f.user, 1000); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if err := f.svc.SyncMailFromPush(f.ctx, f.user, 1500); err != nil {
		t.Fatalf("sync: %v", err)
	}
	if sync.syncCalls != 1 || sync.lastCursor != "1000" {
		t.Fatalf("history walk should start at 1000, calls=%d cursor=%q", sync.syncCalls, sync.lastCursor)
	}
	// Layer-1 threads were indexed (3 external-counterparty threads).
	if n := f.client.MailThread.Query().Where(mailthread.HasUserWith(user.IDEQ(f.user.ID))).CountX(f.ctx); n != 3 {
		t.Fatalf("expected 3 indexed threads, got %d", n)
	}
	// Cursor advanced to the latest history id.
	if got := workspaceCursor(t, f); got != "2000" {
		t.Fatalf("cursor = %q, want 2000", got)
	}
}

// A stale cursor (history gap) resets to the push id and defers to the scan.
func TestPushSyncHistoryGapResets(t *testing.T) {
	f := newFixture(t)
	sync := &fakeMailSyncer{email: selfAddr, err: googleapi.ErrHistoryGap}
	f.svc.SetMailSyncer(sync)

	if err := f.svc.SyncMailFromPush(f.ctx, f.user, 1000); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if err := f.svc.SyncMailFromPush(f.ctx, f.user, 5000); err != nil {
		t.Fatalf("gap sync should not error: %v", err)
	}
	// No threads indexed; cursor jumped to the push id.
	if n := f.client.MailThread.Query().CountX(f.ctx); n != 0 {
		t.Fatalf("gap must not index threads, got %d", n)
	}
	if got := workspaceCursor(t, f); got != "5000" {
		t.Fatalf("cursor after gap = %q, want 5000", got)
	}
}

// No syncer configured → a no-op (push sync disabled).
func TestPushSyncDisabledIsNoop(t *testing.T) {
	f := newFixture(t)
	if err := f.svc.SyncMailFromPush(f.ctx, f.user, 1); err != nil {
		t.Fatalf("disabled push sync should be a no-op, got %v", err)
	}
}
