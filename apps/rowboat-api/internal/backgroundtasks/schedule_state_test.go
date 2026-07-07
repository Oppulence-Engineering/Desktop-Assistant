package backgroundtasks

import (
	"net/http"
	"testing"
	"time"
)

type scheduleStateBody struct {
	Target            string   `json:"target"`
	TriggerSources    []string `json:"triggerSources"`
	Health            string   `json:"health"`
	Mechanism         string   `json:"mechanism"`
	NextDueAt         *string  `json:"nextDueAt"`
	ScheduleSyncState string   `json:"scheduleSyncState"`
	Sources           map[string]struct {
		Mechanism string  `json:"mechanism"`
		Health    string  `json:"health"`
		NextDueAt *string `json:"nextDueAt"`
	} `json:"sources"`
}

func TestScheduleStateDesktopTask(t *testing.T) {
	_, u, router := setupTest(t)
	rec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/", map[string]any{
		"slug": "local-cron", "name": "Local", "instructions": "x",
		"executionTarget": "desktop",
		"triggers":        map[string]any{"cronExpr": "0 9 * * *"},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create = %d", rec.Code)
	}
	stateRec := authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks/local-cron/schedule-state", nil)
	if stateRec.Code != http.StatusOK {
		t.Fatalf("schedule-state = %d: %s", stateRec.Code, stateRec.Body.String())
	}
	body := decodeBody[scheduleStateBody](t, stateRec)
	if body.Target != "desktop" || body.Mechanism != "desktop_loop" || body.Health != "current" {
		t.Fatalf("body = %+v", body)
	}
	if len(body.TriggerSources) != 1 || body.TriggerSources[0] != "cron" {
		t.Fatalf("sources = %v", body.TriggerSources)
	}
	if body.NextDueAt != nil {
		t.Fatalf("desktop task must not claim a server-side next due: %v", *body.NextDueAt)
	}
}

func TestScheduleStateLoopOwnedCron(t *testing.T) {
	// No schedules syncer wired: the loop owns the cron; next due is the
	// gronx-predicted next tick.
	_, u, router := setupTest(t)
	rec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/", map[string]any{
		"slug": "loop-cron", "name": "Loop", "instructions": "x",
		"executionTarget": "api",
		"triggers":        map[string]any{"cronExpr": "*/5 * * * *"},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create = %d", rec.Code)
	}
	stateRec := authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks/loop-cron/schedule-state", nil)
	body := decodeBody[scheduleStateBody](t, stateRec)
	if body.Mechanism != "rowboat_loop" || body.Health != "current" {
		t.Fatalf("body = %+v", body)
	}
	if body.NextDueAt == nil {
		t.Fatal("loop-owned cron must predict the next tick")
	}
	next, err := time.Parse(time.RFC3339, *body.NextDueAt)
	if err != nil || time.Until(next) > 5*time.Minute+time.Second || time.Until(next) < 0 {
		t.Fatalf("nextDueAt = %v (err=%v)", *body.NextDueAt, err)
	}
}

func TestLoopCronNextTickSkipsCurrentMinute(t *testing.T) {
	next, err := nextLoopCronTick("*/5 * * * *", time.Date(2026, 6, 28, 0, 35, 37, 0, time.UTC))
	if err != nil {
		t.Fatalf("nextLoopCronTick: %v", err)
	}
	want := time.Date(2026, 6, 28, 0, 40, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("next = %s, want %s", next.Format(time.RFC3339), want.Format(time.RFC3339))
	}
}

func TestLoopCronNextTickKeepsUpcomingMinute(t *testing.T) {
	next, err := nextLoopCronTick("*/5 * * * *", time.Date(2026, 6, 28, 0, 34, 37, 0, time.UTC))
	if err != nil {
		t.Fatalf("nextLoopCronTick: %v", err)
	}
	want := time.Date(2026, 6, 28, 0, 35, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("next = %s, want %s", next.Format(time.RFC3339), want.Format(time.RFC3339))
	}
}

func TestScheduleStateTemporalOwnedCron(t *testing.T) {
	u, router, mgr := setupScheduleTest(t)
	nextFire := time.Now().UTC().Add(45 * time.Minute).Truncate(time.Second)
	mgr.NextActions = []time.Time{nextFire}

	view := createCronTask(t, router, u) // syncs → current
	if view.ScheduleSyncState != "current" {
		t.Fatalf("precondition: sync state = %q", view.ScheduleSyncState)
	}

	stateRec := authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks/daily-digest/schedule-state", nil)
	body := decodeBody[scheduleStateBody](t, stateRec)
	if body.Mechanism != "temporal_schedule" || body.Health != "current" || body.ScheduleSyncState != "current" {
		t.Fatalf("body = %+v", body)
	}
	if body.NextDueAt == nil || *body.NextDueAt != nextFire.Format(time.RFC3339) {
		t.Fatalf("nextDueAt = %v, want %s", body.NextDueAt, nextFire.Format(time.RFC3339))
	}
	src, ok := body.Sources["cron"]
	if !ok || src.Mechanism != "temporal_schedule" {
		t.Fatalf("cron source = %+v ok=%v", src, ok)
	}
}

func TestScheduleStateFailedSyncFallsBackToLoop(t *testing.T) {
	u, router, mgr := setupScheduleTest(t)
	mgr.UpsertErr = errTemporalDown
	rec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/", map[string]any{
		"slug": "failing", "name": "Failing", "instructions": "x",
		"executionTarget": "api",
		"triggers":        map[string]any{"cronExpr": "0 9 * * *"},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create = %d", rec.Code)
	}
	stateRec := authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks/failing/schedule-state", nil)
	body := decodeBody[scheduleStateBody](t, stateRec)
	// Failed sync → loop is the live mechanism and health surfaces the failure.
	if body.Mechanism != "rowboat_loop" || body.Health != "failed" || body.ScheduleSyncState != "failed" {
		t.Fatalf("body = %+v", body)
	}
	if body.NextDueAt == nil {
		t.Fatal("loop fallback must still predict the next tick")
	}
}

func TestScheduleStateMixedCronWindowEvent(t *testing.T) {
	u, router, mgr := setupScheduleTest(t)
	mgr.NextActions = []time.Time{time.Now().UTC().Add(2 * time.Hour)}
	rec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/", map[string]any{
		"slug": "mixed", "name": "Mixed", "instructions": "x",
		"executionTarget": "api",
		"triggers": map[string]any{
			"cronExpr":           "0 9 * * *",
			"windows":            []map[string]string{{"startTime": "09:00", "endTime": "12:00"}},
			"eventMatchCriteria": "emails from acme about disputes",
		},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create = %d: %s", rec.Code, rec.Body.String())
	}
	stateRec := authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks/mixed/schedule-state", nil)
	body := decodeBody[scheduleStateBody](t, stateRec)
	if len(body.TriggerSources) != 3 {
		t.Fatalf("sources = %v", body.TriggerSources)
	}
	if body.Sources["cron"].Mechanism != "temporal_schedule" ||
		body.Sources["window"].Mechanism != "rowboat_loop" ||
		body.Sources["event"].Mechanism != "none" {
		t.Fatalf("per-source mechanisms = %+v", body.Sources)
	}
	if body.Sources["window"].NextDueAt == nil {
		t.Fatal("window source must report next start")
	}
	if body.Sources["event"].NextDueAt != nil {
		t.Fatal("event source must not claim a next due")
	}
}

func TestScheduleStateManualOnlyAPITask(t *testing.T) {
	_, u, router := setupTest(t)
	rec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/", map[string]any{
		"slug": "manual", "name": "Manual", "instructions": "x",
		"executionTarget": "api",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create = %d", rec.Code)
	}
	stateRec := authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks/manual/schedule-state", nil)
	body := decodeBody[scheduleStateBody](t, stateRec)
	if body.Mechanism != "none" || len(body.TriggerSources) != 0 || body.NextDueAt != nil {
		t.Fatalf("body = %+v", body)
	}
}

var errTemporalDown = errTemporal{}

type errTemporal struct{}

func (errTemporal) Error() string { return "temporal unreachable" }
