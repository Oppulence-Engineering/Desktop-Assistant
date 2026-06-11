package backgroundtasks

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskschedule"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"go.uber.org/zap"
)

func setupScheduleTest(t *testing.T) (*ent.User, http.Handler, *backgroundtaskschedule.FakeManager) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })

	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(context.Background())
	h := New(d.Client, zap.NewNop())
	mgr := backgroundtaskschedule.NewFakeManager()
	h.SetSchedules(&backgroundtaskschedule.Syncer{
		Client:  d.Client,
		Manager: mgr,
		Cfg: appconfig.Config{
			TemporalSchedulesEnabled: true,
			CloudSchedulerTimezone:   "UTC",
		},
		Log: zap.NewNop(),
	})
	return u, testRouter(h), mgr
}

func createCronTask(t *testing.T, router http.Handler, u *ent.User) taskView {
	t.Helper()
	rec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/", map[string]any{
		"slug":            "daily-digest",
		"name":            "Daily Digest",
		"instructions":    "Summarize the day.",
		"executionTarget": "api",
		"triggers":        map[string]any{"cronExpr": "0 9 * * *"},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create = %d: %s", rec.Code, rec.Body.String())
	}
	return decodeBody[taskView](t, rec)
}

func TestCreateWithCronSyncsSchedule(t *testing.T) {
	u, router, mgr := setupScheduleTest(t)
	view := createCronTask(t, router, u)
	if view.ScheduleSyncState != "current" || view.ScheduleSyncedAt == nil {
		t.Fatalf("view sync = %q syncedAt=%v", view.ScheduleSyncState, view.ScheduleSyncedAt)
	}
	d, ok := mgr.Schedule(u.ID.String(), "daily-digest")
	if !ok || d.CronExpr != "0 9 * * *" || d.Paused {
		t.Fatalf("schedule = %+v ok=%v", d, ok)
	}
}

func TestCreateUpsertFailureStillCreatesTask(t *testing.T) {
	u, router, mgr := setupScheduleTest(t)
	mgr.UpsertErr = errors.New("temporal unreachable")
	rec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/", map[string]any{
		"slug":            "daily-digest",
		"name":            "Daily Digest",
		"instructions":    "Summarize the day.",
		"executionTarget": "api",
		"triggers":        map[string]any{"cronExpr": "0 9 * * *"},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("schedule failure must not fail the create: %d %s", rec.Code, rec.Body.String())
	}
	view := decodeBody[taskView](t, rec)
	if view.ScheduleSyncState != "failed" || !strings.Contains(view.ScheduleSyncError, "temporal schedule") {
		t.Fatalf("view sync = %q err=%q", view.ScheduleSyncState, view.ScheduleSyncError)
	}
}

func TestPatchCronRemovedDeletesSchedule(t *testing.T) {
	u, router, mgr := setupScheduleTest(t)
	view := createCronTask(t, router, u)

	rec := authedJSON(t, router, u, http.MethodPatch, "/v1/background-tasks/daily-digest", map[string]any{
		"revision": view.Revision,
		"triggers": map[string]any{"windows": []map[string]string{{"startTime": "09:00", "endTime": "12:00"}}},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("patch = %d: %s", rec.Code, rec.Body.String())
	}
	patched := decodeBody[taskView](t, rec)
	if patched.ScheduleSyncState != "paused" {
		t.Fatalf("sync state = %q", patched.ScheduleSyncState)
	}
	if _, ok := mgr.Schedule(u.ID.String(), "daily-digest"); ok {
		t.Fatal("schedule must be deleted when cron is removed")
	}
}

func TestPatchInactivePausesSchedule(t *testing.T) {
	u, router, mgr := setupScheduleTest(t)
	view := createCronTask(t, router, u)

	rec := authedJSON(t, router, u, http.MethodPatch, "/v1/background-tasks/daily-digest", map[string]any{
		"revision": view.Revision,
		"active":   false,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("patch = %d: %s", rec.Code, rec.Body.String())
	}
	patched := decodeBody[taskView](t, rec)
	if patched.ScheduleSyncState != "paused" {
		t.Fatalf("sync state = %q", patched.ScheduleSyncState)
	}
	d, ok := mgr.Schedule(u.ID.String(), "daily-digest")
	if !ok || !d.Paused {
		t.Fatalf("schedule must be kept paused: %+v ok=%v", d, ok)
	}
}

func TestPatchTargetDesktopDeletesSchedule(t *testing.T) {
	u, router, mgr := setupScheduleTest(t)
	view := createCronTask(t, router, u)

	rec := authedJSON(t, router, u, http.MethodPatch, "/v1/background-tasks/daily-digest", map[string]any{
		"revision":        view.Revision,
		"executionTarget": "desktop",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("patch = %d: %s", rec.Code, rec.Body.String())
	}
	if _, ok := mgr.Schedule(u.ID.String(), "daily-digest"); ok {
		t.Fatal("schedule must be deleted when the task moves to desktop")
	}
}

func TestDeleteRemovesScheduleAfterCommit(t *testing.T) {
	u, router, mgr := setupScheduleTest(t)
	view := createCronTask(t, router, u)

	rec := authedJSON(t, router, u, http.MethodDelete, "/v1/background-tasks/daily-digest?revision="+strconv.Itoa(view.Revision), nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete = %d: %s", rec.Code, rec.Body.String())
	}
	if _, ok := mgr.Schedule(u.ID.String(), "daily-digest"); ok {
		t.Fatal("schedule must be deleted with the task")
	}
}

func TestDeleteStaleRevisionKeepsSchedule(t *testing.T) {
	u, router, mgr := setupScheduleTest(t)
	view := createCronTask(t, router, u)

	rec := authedJSON(t, router, u, http.MethodDelete, "/v1/background-tasks/daily-digest?revision="+strconv.Itoa(view.Revision+99), nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("stale delete = %d: %s", rec.Code, rec.Body.String())
	}
	if _, ok := mgr.Schedule(u.ID.String(), "daily-digest"); !ok {
		t.Fatal("a 409 delete must NOT remove the schedule")
	}
}

func TestDeleteScheduleFailureStillDeletesTask(t *testing.T) {
	u, router, mgr := setupScheduleTest(t)
	view := createCronTask(t, router, u)
	mgr.DeleteErr = errors.New("temporal unreachable")

	rec := authedJSON(t, router, u, http.MethodDelete, "/v1/background-tasks/daily-digest?revision="+strconv.Itoa(view.Revision), nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete = %d: %s", rec.Code, rec.Body.String())
	}
	getRec := authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks/daily-digest", nil)
	if getRec.Code != http.StatusNotFound {
		t.Fatalf("task must be gone even when schedule delete fails: %d", getRec.Code)
	}
}

func TestNoSchedulerConfiguredLeavesDefaultState(t *testing.T) {
	u, router := func() (*ent.User, http.Handler) {
		client, user, r := setupTest(t)
		_ = client
		return user, r
	}()
	view := func() taskView {
		rec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/", map[string]any{
			"slug": "plain", "name": "Plain", "instructions": "x",
			"executionTarget": "api",
			"triggers":        map[string]any{"cronExpr": "0 9 * * *"},
		})
		if rec.Code != http.StatusCreated {
			t.Fatalf("create = %d", rec.Code)
		}
		return decodeBody[taskView](t, rec)
	}()
	if view.ScheduleSyncState != "paused" {
		t.Fatalf("default sync state = %q, want paused", view.ScheduleSyncState)
	}
}
