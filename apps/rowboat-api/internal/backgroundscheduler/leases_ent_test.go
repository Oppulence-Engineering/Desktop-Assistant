package backgroundscheduler

import (
	"context"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	btss "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskschedulestate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"go.uber.org/zap"
)

// leaseTask creates a task with its user edge loaded, as EntLeases.Acquire
// requires (the scheduler loads tasks WithUser).
func leaseTask(t *testing.T, client *ent.Client, u *ent.User, slug string) *ent.BackgroundTask {
	t.Helper()
	ctx := auth.WithInternal(context.Background())
	client.BackgroundTask.Create().
		SetUser(u).SetSlug(slug).SetName(slug).SetInstructions("x").SetExecutionTarget("api").
		SaveX(ctx)
	return client.BackgroundTask.Query().Where(backgroundtask.SlugEQ(slug)).WithUser().OnlyX(ctx)
}

// Note: these exercise the lease state machine on sqlite. The cross-replica
// concurrency guarantee (exactly one winner under N racers) is a Postgres
// property covered by the testcontainer suite (RFC 002 002-F).

func TestEntLeasesAcquireHeldFiredSkip(t *testing.T) {
	client := openDB(t)
	ctx := auth.WithInternal(context.Background())
	u := newUser(t, client, "a@x.co", "u1")
	task := leaseTask(t, client, u, "t1")
	l := NewEntLeases(client, zap.NewNop())

	lease, ok, err := l.Acquire(ctx, task, "cron", "cron:k1", "ownerA", time.Minute)
	if err != nil || !ok {
		t.Fatalf("first acquire should win: ok=%v err=%v", ok, err)
	}
	// A peer hits the live lease → skipped.
	if _, ok2, err := l.Acquire(ctx, task, "cron", "cron:k1", "ownerB", time.Minute); err != nil || ok2 {
		t.Fatalf("acquire on a held cycle should skip: ok=%v err=%v", ok2, err)
	}
	// Complete → fired sentinel set.
	if err := l.Complete(ctx, lease, "sched-cron-1"); err != nil {
		t.Fatalf("complete: %v", err)
	}
	row := client.BackgroundTaskScheduleState.Query().Where(btss.IDEQ(lease.ID)).OnlyX(ctx)
	if row.LastRunID != "sched-cron-1" || row.LastTriggeredAt == nil {
		t.Fatalf("complete did not set fired sentinel: %+v", row)
	}
	// Acquire after fired → permanently skipped.
	if _, ok3, err := l.Acquire(ctx, task, "cron", "cron:k1", "ownerA", time.Minute); err != nil || ok3 {
		t.Fatalf("acquire after fired should skip: ok=%v err=%v", ok3, err)
	}
}

func TestEntLeasesStealExpired(t *testing.T) {
	client := openDB(t)
	ctx := auth.WithInternal(context.Background())
	u := newUser(t, client, "b@x.co", "u2")
	task := leaseTask(t, client, u, "t2")
	l := NewEntLeases(client, zap.NewNop())

	// Acquire with an already-expired lease (negative ttl) → owner "crashed".
	if _, ok, err := l.Acquire(ctx, task, "cron", "cron:k2", "ownerCrashed", -time.Second); err != nil || !ok {
		t.Fatalf("seed expired lease: ok=%v err=%v", ok, err)
	}
	// Next acquire steals it.
	lease, ok, err := l.Acquire(ctx, task, "cron", "cron:k2", "ownerB", time.Minute)
	if err != nil || !ok {
		t.Fatalf("steal expired lease: ok=%v err=%v", ok, err)
	}
	if lease.Owner != "ownerB" {
		t.Fatalf("stealer owner = %q, want ownerB", lease.Owner)
	}
}

func TestEntLeasesReleaseAllowsReacquire(t *testing.T) {
	client := openDB(t)
	ctx := auth.WithInternal(context.Background())
	u := newUser(t, client, "c@x.co", "u3")
	task := leaseTask(t, client, u, "t3")
	l := NewEntLeases(client, zap.NewNop())

	lease, ok, _ := l.Acquire(ctx, task, "window", "window:k3", "ownerA", time.Minute)
	if !ok {
		t.Fatal("acquire")
	}
	if err := l.Release(ctx, lease, nil); err != nil {
		t.Fatalf("release: %v", err)
	}
	// Released lease (no last_run_id, cleared owner/expiry) → next acquire steals.
	if _, ok2, err := l.Acquire(ctx, task, "window", "window:k3", "ownerB", time.Minute); err != nil || !ok2 {
		t.Fatalf("reacquire after release: ok=%v err=%v", ok2, err)
	}
}

func TestEntLeasesDistinctKeysAndTasksDoNotCollide(t *testing.T) {
	client := openDB(t)
	ctx := auth.WithInternal(context.Background())
	u := newUser(t, client, "d@x.co", "u4")
	task1 := leaseTask(t, client, u, "t4a")
	task2 := leaseTask(t, client, u, "t4b")
	l := NewEntLeases(client, zap.NewNop())

	// Same key, different tasks → both win (unique index includes the task).
	_, ok1, _ := l.Acquire(ctx, task1, "cron", "cron:same", "o", time.Minute)
	_, ok2, _ := l.Acquire(ctx, task2, "cron", "cron:same", "o", time.Minute)
	if !ok1 || !ok2 {
		t.Fatalf("same key, different tasks should both acquire: %v %v", ok1, ok2)
	}
	// Same task, different key → wins.
	if _, ok3, _ := l.Acquire(ctx, task1, "cron", "cron:other", "o", time.Minute); !ok3 {
		t.Fatal("different key, same task should acquire")
	}
}

func TestEntLeasesPruneFiredAfterRetention(t *testing.T) {
	client := openDB(t)
	ctx := auth.WithInternal(context.Background())
	u := newUser(t, client, "e@x.co", "u5")
	task := leaseTask(t, client, u, "t5")
	l := NewEntLeases(client, zap.NewNop())

	// A fired row older than retention is pruned; a recent fired row is kept.
	old := client.BackgroundTaskScheduleState.Create().
		SetUser(u).SetTask(task).SetTriggerType("cron").SetScheduleKey("cron:old").
		SetLastRunID("run-old").SetLastTriggeredAt(time.Now().UTC()).
		SetCreatedAt(time.Now().UTC().Add(-scheduleStateRetention - time.Hour)).
		SaveX(ctx)
	recentLease, _, _ := l.Acquire(ctx, task, "cron", "cron:recent", "o", time.Minute)
	_ = l.Complete(ctx, recentLease, "run-recent")

	if err := l.CleanupExpired(ctx); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	if n := client.BackgroundTaskScheduleState.Query().Where(btss.IDEQ(old.ID)).CountX(ctx); n != 0 {
		t.Fatalf("fired row older than retention should be pruned")
	}
	if n := client.BackgroundTaskScheduleState.Query().Where(btss.IDEQ(recentLease.ID)).CountX(ctx); n != 1 {
		t.Fatalf("recent fired row should be kept")
	}
}
