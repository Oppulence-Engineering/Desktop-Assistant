package backgroundtaskschedule

import (
	"context"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"go.uber.org/zap"
)

func newReconciler(s *Syncer) *Reconciler {
	return &Reconciler{
		Client:   s.Client,
		Manager:  s.Manager,
		Syncer:   s,
		Interval: time.Minute,
		Log:      zap.NewNop(),
	}
}

func reloadTask(t *testing.T, s *Syncer, task *ent.BackgroundTask) *ent.BackgroundTask {
	t.Helper()
	return s.reload(context.Background(), task)
}

func TestReconcileCreatesMissingSchedule(t *testing.T) {
	s, mgr, u, task := setupSyncer(t)
	// Handler upsert never happened (e.g. it failed): task is active api+cron
	// with state failed and no schedule.
	task = task.Update().SetScheduleSyncState("failed").SetScheduleSyncError("temporal unreachable").SaveX(context.Background())

	newReconciler(s).ReconcileOnce(context.Background())

	if _, ok := mgr.Schedule(u.ID.String(), "daily-digest"); !ok {
		t.Fatal("missing schedule must be created")
	}
	got := reloadTask(t, s, task)
	if got.ScheduleSyncState != "current" || got.ScheduleSyncError != "" {
		t.Fatalf("state=%q err=%q, want repaired to current", got.ScheduleSyncState, got.ScheduleSyncError)
	}
}

func TestReconcileRepairsStaleSpec(t *testing.T) {
	s, mgr, u, task := setupSyncer(t)
	s.AfterWrite(context.Background(), u.ID.String(), task) // current @ 0 9 * * *
	// The schedule drifts: seed an old cron under the same id.
	stale, _ := mgr.Schedule(u.ID.String(), "daily-digest")
	stale.CronExpr = "0 0 * * *"
	mgr.Seed(stale)

	newReconciler(s).ReconcileOnce(context.Background())

	d, _ := mgr.Schedule(u.ID.String(), "daily-digest")
	if d.CronExpr != "0 9 * * *" {
		t.Fatalf("stale spec not repaired: %q", d.CronExpr)
	}
}

func TestReconcileUnpausesActiveTask(t *testing.T) {
	s, mgr, u, task := setupSyncer(t)
	s.AfterWrite(context.Background(), u.ID.String(), task) // current
	d, _ := mgr.Schedule(u.ID.String(), "daily-digest")
	d.Paused = true
	mgr.Seed(d) // schedule wrongly paused while task active

	newReconciler(s).ReconcileOnce(context.Background())

	d, _ = mgr.Schedule(u.ID.String(), "daily-digest")
	if d.Paused {
		t.Fatal("schedule paused for an active task must be unpaused")
	}
}

func TestReconcileEnsuresInactivePausedSchedule(t *testing.T) {
	s, mgr, u, task := setupSyncer(t)
	task = task.Update().SetActive(false).SaveX(context.Background())

	newReconciler(s).ReconcileOnce(context.Background())

	d, ok := mgr.Schedule(u.ID.String(), "daily-digest")
	if !ok || !d.Paused {
		t.Fatalf("inactive cron task must hold a paused schedule: %+v ok=%v", d, ok)
	}
	got := reloadTask(t, s, task)
	if got.ScheduleSyncState != "paused" {
		t.Fatalf("state = %q", got.ScheduleSyncState)
	}
}

func TestReconcileDeletesOrphanOfDeletedTask(t *testing.T) {
	s, mgr, _, _ := setupSyncer(t)
	// A schedule whose task no longer exists at all.
	mgr.Seed(DesiredCronSchedule{
		UserID: "ghost-user", Slug: "ghost-task",
		CronExpr: "0 9 * * *", Timezone: "UTC", TaskRevision: 1,
	})

	newReconciler(s).ReconcileOnce(context.Background())

	if _, ok := mgr.Schedule("ghost-user", "ghost-task"); ok {
		t.Fatal("orphan schedule must be swept")
	}
}

func TestReconcileDeletesScheduleForDesktopFlip(t *testing.T) {
	s, mgr, u, task := setupSyncer(t)
	task = s.AfterWrite(context.Background(), u.ID.String(), task) // current + schedule
	// Simulate a target flip whose handler-side delete was missed.
	task = task.Update().SetExecutionTarget("desktop").SetScheduleSyncState("current").SaveX(context.Background())

	newReconciler(s).ReconcileOnce(context.Background())

	if _, ok := mgr.Schedule(u.ID.String(), "daily-digest"); ok {
		t.Fatal("schedule for a desktop task must be deleted")
	}
	got := reloadTask(t, s, task)
	if got.ScheduleSyncState != "paused" {
		t.Fatalf("state = %q", got.ScheduleSyncState)
	}
}

func TestReconcileInvalidCronMarksFailedAndDeletes(t *testing.T) {
	s, mgr, u, task := setupSyncer(t)
	task = s.AfterWrite(context.Background(), u.ID.String(), task) // current + schedule
	task = task.Update().SetTriggersJSON(`{"cronExpr":"not a cron"}`).SetScheduleSyncState("current").SaveX(context.Background())

	newReconciler(s).ReconcileOnce(context.Background())

	if _, ok := mgr.Schedule(u.ID.String(), "daily-digest"); ok {
		t.Fatal("schedule for an invalid cron must be deleted")
	}
	got := reloadTask(t, s, task)
	if got.ScheduleSyncState != "failed" {
		t.Fatalf("state = %q, want failed", got.ScheduleSyncState)
	}
}

func TestReconcileNoopWhenConverged(t *testing.T) {
	s, mgr, u, task := setupSyncer(t)
	task = s.AfterWrite(context.Background(), u.ID.String(), task) // current
	before := reloadTask(t, s, task)

	newReconciler(s).ReconcileOnce(context.Background())

	after := reloadTask(t, s, task)
	if after.ScheduleSyncState != "current" || after.Revision != before.Revision {
		t.Fatalf("converged task must not be rewritten: state=%q rev %d→%d",
			after.ScheduleSyncState, before.Revision, after.Revision)
	}
	if _, ok := mgr.Schedule(u.ID.String(), "daily-digest"); !ok {
		t.Fatal("schedule must survive a converged pass")
	}
}

func TestParseScheduleID(t *testing.T) {
	userID, slug, ok := parseScheduleID("background-task-schedule/u1/daily-digest/cron")
	if !ok || userID != "u1" || slug != "daily-digest" {
		t.Fatalf("parse = %q %q %v", userID, slug, ok)
	}
	for _, bad := range []string{
		"other/u1/s/cron",
		"background-task-schedule/u1/s/window",
		"background-task-schedule//s/cron",
		"background-task-schedule/u1/cron",
	} {
		if _, _, ok := parseScheduleID(bad); ok {
			t.Fatalf("parse %q must fail", bad)
		}
	}
}
