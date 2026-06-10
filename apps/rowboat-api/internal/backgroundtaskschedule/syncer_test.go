package backgroundtaskschedule

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"go.uber.org/zap"
)

func setupSyncer(t *testing.T) (*Syncer, *FakeManager, *ent.User, *ent.BackgroundTask) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	ctx := context.Background()
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	task := d.Client.BackgroundTask.Create().
		SetUser(u).SetSlug("daily-digest").SetName("Daily Digest").
		SetInstructions("Summarize the day.").SetExecutionTarget("api").
		SetTriggersJSON(`{"cronExpr":"0 9 * * *"}`).
		SaveX(ctx)
	mgr := NewFakeManager()
	cfg := appconfig.Config{
		TemporalSchedulesEnabled: true,
		CloudSchedulerTimezone:   "UTC",
	}
	return &Syncer{Client: d.Client, Manager: mgr, Cfg: cfg, Log: zap.NewNop()}, mgr, u, task
}

func TestAfterWriteFlagOffUntouched(t *testing.T) {
	s, mgr, u, task := setupSyncer(t)
	s.Cfg.TemporalSchedulesEnabled = false
	got := s.AfterWrite(context.Background(), u.ID.String(), task)
	if got.ScheduleSyncState != "paused" || len(mgr.Calls) != 0 {
		t.Fatalf("state=%q calls=%v, want untouched", got.ScheduleSyncState, mgr.Calls)
	}
}

func TestAfterWriteManagedCronBecomesCurrent(t *testing.T) {
	s, mgr, u, task := setupSyncer(t)
	got := s.AfterWrite(context.Background(), u.ID.String(), task)
	if got.ScheduleSyncState != "current" {
		t.Fatalf("state = %q, want current (err=%q)", got.ScheduleSyncState, got.ScheduleSyncError)
	}
	if got.ScheduleSyncedAt == nil || got.ScheduleSyncError != "" {
		t.Fatalf("synced_at=%v err=%q", got.ScheduleSyncedAt, got.ScheduleSyncError)
	}
	d, ok := mgr.Schedule(u.ID.String(), "daily-digest")
	if !ok || d.CronExpr != "0 9 * * *" || d.Paused {
		t.Fatalf("stored desired = %+v", d)
	}
	if got.Revision <= task.Revision {
		t.Fatalf("revision %d must bump past %d", got.Revision, task.Revision)
	}
}

func TestAfterWriteUpsertFailureMarksFailed(t *testing.T) {
	s, mgr, u, task := setupSyncer(t)
	mgr.UpsertErr = errors.New("temporal unreachable")
	got := s.AfterWrite(context.Background(), u.ID.String(), task)
	if got.ScheduleSyncState != "failed" || !strings.Contains(got.ScheduleSyncError, "temporal unreachable") {
		t.Fatalf("state=%q err=%q", got.ScheduleSyncState, got.ScheduleSyncError)
	}

	// failed → syncing → current once Temporal recovers (retry path).
	mgr.UpsertErr = nil
	got = s.AfterWrite(context.Background(), u.ID.String(), got)
	if got.ScheduleSyncState != "current" || got.ScheduleSyncError != "" {
		t.Fatalf("after retry: state=%q err=%q", got.ScheduleSyncState, got.ScheduleSyncError)
	}
}

func TestAfterWriteInvalidCronFailsWithoutTemporal(t *testing.T) {
	s, mgr, u, task := setupSyncer(t)
	task = task.Update().SetTriggersJSON(`{"cronExpr":"not a cron"}`).SaveX(context.Background())
	got := s.AfterWrite(context.Background(), u.ID.String(), task)
	if got.ScheduleSyncState != "failed" || !strings.Contains(got.ScheduleSyncError, "invalid cron") {
		t.Fatalf("state=%q err=%q", got.ScheduleSyncState, got.ScheduleSyncError)
	}
	if len(mgr.Calls) != 0 {
		t.Fatalf("invalid cron must not reach Temporal: %v", mgr.Calls)
	}
}

func TestAfterWriteInactivePausesSchedule(t *testing.T) {
	s, mgr, u, task := setupSyncer(t)
	task = s.AfterWrite(context.Background(), u.ID.String(), task) // current
	task = task.Update().SetActive(false).SaveX(context.Background())

	got := s.AfterWrite(context.Background(), u.ID.String(), task)
	if got.ScheduleSyncState != "paused" || got.ScheduleSyncError != "" {
		t.Fatalf("state=%q err=%q", got.ScheduleSyncState, got.ScheduleSyncError)
	}
	d, ok := mgr.Schedule(u.ID.String(), "daily-digest")
	if !ok || !d.Paused {
		t.Fatalf("schedule should be kept paused for fast unpause: %+v ok=%v", d, ok)
	}
}

func TestAfterWriteCronRemovedDeletesSchedule(t *testing.T) {
	s, mgr, u, task := setupSyncer(t)
	task = s.AfterWrite(context.Background(), u.ID.String(), task) // current
	task = task.Update().SetTriggersJSON(`{"windows":[{"startTime":"09:00","endTime":"12:00"}]}`).SaveX(context.Background())

	got := s.AfterWrite(context.Background(), u.ID.String(), task)
	if got.ScheduleSyncState != "paused" {
		t.Fatalf("state = %q", got.ScheduleSyncState)
	}
	if _, ok := mgr.Schedule(u.ID.String(), "daily-digest"); ok {
		t.Fatal("schedule must be deleted when the cron is removed")
	}
}

func TestAfterWriteTargetFlipToDesktopDeletesSchedule(t *testing.T) {
	s, mgr, u, task := setupSyncer(t)
	task = s.AfterWrite(context.Background(), u.ID.String(), task) // current
	task = task.Update().SetExecutionTarget("desktop").SaveX(context.Background())

	got := s.AfterWrite(context.Background(), u.ID.String(), task)
	if got.ScheduleSyncState != "paused" {
		t.Fatalf("state = %q", got.ScheduleSyncState)
	}
	if _, ok := mgr.Schedule(u.ID.String(), "daily-digest"); ok {
		t.Fatal("schedule must be deleted when the task moves to desktop")
	}
}

func TestAfterWriteNeverScheduledSkipsTemporal(t *testing.T) {
	s, mgr, u, task := setupSyncer(t)
	// A desktop task that never had a schedule: the common write path must not
	// pay a Temporal round-trip.
	task = task.Update().SetExecutionTarget("desktop").SaveX(context.Background())
	got := s.AfterWrite(context.Background(), u.ID.String(), task)
	if got.ScheduleSyncState != "paused" || len(mgr.Calls) != 0 {
		t.Fatalf("state=%q calls=%v", got.ScheduleSyncState, mgr.Calls)
	}
}

func TestAfterWritePauseFailureRecordsError(t *testing.T) {
	s, mgr, u, task := setupSyncer(t)
	task = s.AfterWrite(context.Background(), u.ID.String(), task) // current
	task = task.Update().SetActive(false).SaveX(context.Background())
	mgr.PauseErr = errors.New("temporal unreachable")

	got := s.AfterWrite(context.Background(), u.ID.String(), task)
	if got.ScheduleSyncState != "paused" || !strings.Contains(got.ScheduleSyncError, "temporal unreachable") {
		t.Fatalf("state=%q err=%q", got.ScheduleSyncState, got.ScheduleSyncError)
	}
}

func TestAfterDelete(t *testing.T) {
	s, mgr, u, task := setupSyncer(t)
	task = s.AfterWrite(context.Background(), u.ID.String(), task) // schedule exists
	s.AfterDelete(context.Background(), u.ID.String(), task)
	if _, ok := mgr.Schedule(u.ID.String(), "daily-digest"); ok {
		t.Fatal("AfterDelete must delete the schedule")
	}

	// Never-scheduled task: no Temporal call.
	calls := len(mgr.Calls)
	fresh := s.Client.BackgroundTask.Create().
		SetUser(u).SetSlug("plain").SetName("Plain").
		SetInstructions("x").SetExecutionTarget("desktop").
		SaveX(context.Background())
	s.AfterDelete(context.Background(), u.ID.String(), fresh)
	if len(mgr.Calls) != calls {
		t.Fatalf("never-scheduled delete must not call Temporal: %v", mgr.Calls[calls:])
	}
}
