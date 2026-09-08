package revenue

import (
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailmessagemeta"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailthread"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
)

// A scan populates the Layer-1 mail index (metadata only) for swept threads.
func TestScanPopulatesMailIndex(t *testing.T) {
	f := newFixture(t)
	f.svc.SetSweeper(&fakeSweeper{threads: scanFixtureThreads(), email: selfAddr})

	scan, err := f.svc.StartScan(f.ctx, f.user, 90)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	waitScan(t, f, scan.ID)

	// scanFixtureThreads has four threads; three have an external counterparty
	// (the noreply one is skipped by summarizeThread).
	threads := f.client.MailThread.Query().Where(mailthread.HasUserWith(user.IDEQ(f.user.ID))).CountX(f.ctx)
	if threads != 3 {
		t.Fatalf("expected 3 indexed threads, got %d", threads)
	}
	msgs := f.client.MailMessageMeta.Query().Where(mailmessagemeta.HasUserWith(user.IDEQ(f.user.ID))).CountX(f.ctx)
	if msgs < 2 {
		t.Fatalf("expected message metadata rows, got %d", msgs)
	}
	// The index must carry reply-state and never a body column (compile-time
	// guaranteed by the schema; here we assert reply_state is set).
	one := f.client.MailThread.Query().Where(mailthread.HasUserWith(user.IDEQ(f.user.ID))).FirstX(f.ctx)
	if one.ReplyState == "" {
		t.Fatal("reply_state should be derived")
	}

	// A rerun is idempotent: no duplicate threads/messages.
	scan2, _ := f.svc.StartScan(f.ctx, f.user, 90)
	waitScan(t, f, scan2.ID)
	if got := f.client.MailThread.Query().Where(mailthread.HasUserWith(user.IDEQ(f.user.ID))).CountX(f.ctx); got != 3 {
		t.Fatalf("rerun must not duplicate threads, got %d", got)
	}
}

// Disconnect purge: PurgeMailIndex drops Layers 1-3 but leaves Layer-4 evidence.
func TestPurgeMailIndexKeepsEvidence(t *testing.T) {
	f := newFixture(t)
	f.svc.SetSweeper(&fakeSweeper{threads: scanFixtureThreads(), email: selfAddr})
	scan, _ := f.svc.StartScan(f.ctx, f.user, 90)
	waitScan(t, f, scan.ID)

	evidenceBefore := f.client.RevenueEvidence.Query().CountX(f.ctx)
	if evidenceBefore == 0 {
		t.Fatal("scan should have created Layer-4 evidence")
	}

	deleted, err := f.svc.PurgeMailIndex(f.ctx, f.user)
	if err != nil {
		t.Fatalf("purge: %v", err)
	}
	if deleted == 0 {
		t.Fatal("purge should have removed index rows")
	}
	if got := f.client.MailThread.Query().CountX(f.ctx); got != 0 {
		t.Fatalf("Layer-1 threads must be gone after purge, got %d", got)
	}
	if got := f.client.MailMessageMeta.Query().CountX(f.ctx); got != 0 {
		t.Fatalf("Layer-1 messages must be gone after purge, got %d", got)
	}
	// Layer 4 (evidence) survives disconnect — the user's own action history.
	if got := f.client.RevenueEvidence.Query().CountX(f.ctx); got != evidenceBefore {
		t.Fatalf("Layer-4 evidence must survive purge: was %d, now %d", evidenceBefore, got)
	}
}

// Retention sweep prunes rows older than the cutoff and keeps recent ones.
func TestSweepMailRetention(t *testing.T) {
	f := newFixture(t)
	ws, _ := f.svc.CurrentWorkspace(f.ctx, f.user)
	_ = ws

	old := f.client.MailThread.Create().
		SetUser(f.user).SetProvider("gmail").SetProviderThreadID("old").
		SetReplyState("quiet").SetLastActivityAt(time.Now().Add(-600 * 24 * time.Hour)).
		SaveX(f.ctx)
	recent := f.client.MailThread.Create().
		SetUser(f.user).SetProvider("gmail").SetProviderThreadID("recent").
		SetReplyState("quiet").SetLastActivityAt(time.Now().Add(-10 * 24 * time.Hour)).
		SaveX(f.ctx)

	cutoff := time.Now().AddDate(0, -18, 0)
	if _, err := f.svc.SweepMailRetention(f.ctx, cutoff); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if exists := f.client.MailThread.Query().Where(mailthread.IDEQ(old.ID)).ExistX(f.ctx); exists {
		t.Fatal("stale thread should be pruned")
	}
	if exists := f.client.MailThread.Query().Where(mailthread.IDEQ(recent.ID)).ExistX(f.ctx); !exists {
		t.Fatal("recent thread should be kept")
	}
}
