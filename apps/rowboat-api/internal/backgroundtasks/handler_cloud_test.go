package backgroundtasks

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"go.uber.org/zap"
)

// setupTemporalTest builds an in-memory handler with a fake Temporal controller.
func setupTemporalTest(t *testing.T) (*ent.User, http.Handler, *fakeTemporal) {
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
	temporal := &fakeTemporal{}
	h := New(d.Client, zap.NewNop())
	h.SetTemporal(temporal)
	return u, testRouter(h), temporal
}

func createAPITask(t *testing.T, router http.Handler, u *ent.User, slug string) {
	t.Helper()
	rec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/", map[string]any{
		"slug":            slug,
		"name":            "API Task",
		"instructions":    "Run on the server.",
		"executionTarget": "api",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create api task: want 201, got %d: %s", rec.Code, rec.Body.String())
	}
}

type eventsResponse struct {
	Events []eventView `json:"events"`
}

type runsResponse struct {
	Runs       []runView `json:"runs"`
	NextCursor string    `json:"nextCursor"`
}

// TestCloudRunQueuedEventAndRetryLineage covers the queued lifecycle event, the
// retry trigger/lineage/attempt fields, and the terminal-only retry guard.
func TestCloudRunQueuedEventAndRetryLineage(t *testing.T) {
	u, router, temporal := setupTemporalTest(t)
	createAPITask(t, router, u, "api-task")

	triggerRec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/api-task/trigger", map[string]any{
		"trigger": "manual",
		"context": "Run now.",
	})
	if triggerRec.Code != http.StatusAccepted {
		t.Fatalf("trigger: want 202, got %d: %s", triggerRec.Code, triggerRec.Body.String())
	}
	run := decodeBody[runView](t, triggerRec)
	if run.Attempt != 1 {
		t.Fatalf("first run attempt = %d, want 1", run.Attempt)
	}

	// A queued lifecycle event must exist for the freshly triggered run.
	evRec := authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks/api-task/runs/"+run.RunID+"/events", nil)
	events := decodeBody[eventsResponse](t, evRec)
	if !hasEventType(events.Events, backgroundtaskworkflow.EventQueued) {
		t.Fatalf("expected %s event, got %+v", backgroundtaskworkflow.EventQueued, events.Events)
	}

	// Retry before terminal must be rejected.
	earlyRetry := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/api-task/runs/"+run.RunID+"/retry", nil)
	if earlyRetry.Code != http.StatusBadRequest {
		t.Fatalf("retry of queued run: want 400, got %d: %s", earlyRetry.Code, earlyRetry.Body.String())
	}

	// Cancel → stopped, with a cancel-requested timestamp and stop events.
	cancelRec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/api-task/runs/"+run.RunID+"/cancel", nil)
	if cancelRec.Code != http.StatusAccepted {
		t.Fatalf("cancel: want 202, got %d: %s", cancelRec.Code, cancelRec.Body.String())
	}
	canceled := decodeBody[runView](t, cancelRec)
	if canceled.Status != "stopped" || canceled.CancelRequestedAt == nil {
		t.Fatalf("unexpected canceled run: %+v", canceled)
	}
	evRec = authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks/api-task/runs/"+run.RunID+"/events", nil)
	events = decodeBody[eventsResponse](t, evRec)
	if !hasEventType(events.Events, backgroundtaskworkflow.EventCancelRequested) ||
		!hasEventType(events.Events, backgroundtaskworkflow.EventStopped) {
		t.Fatalf("expected cancel_requested + stopped events, got %+v", events.Events)
	}

	// Retry of a terminal run → new run with trigger=retry, lineage, attempt+1.
	retryRec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/api-task/runs/"+run.RunID+"/retry", nil)
	if retryRec.Code != http.StatusAccepted {
		t.Fatalf("retry: want 202, got %d: %s", retryRec.Code, retryRec.Body.String())
	}
	retry := decodeBody[runView](t, retryRec)
	if retry.Trigger != "retry" {
		t.Fatalf("retry trigger = %q, want retry", retry.Trigger)
	}
	if retry.RetryOfRunID != run.RunID || retry.PreviousRunID != run.RunID {
		t.Fatalf("retry lineage = retryOf %q / prev %q, want both %q", retry.RetryOfRunID, retry.PreviousRunID, run.RunID)
	}
	if retry.Attempt != 2 {
		t.Fatalf("retry attempt = %d, want 2", retry.Attempt)
	}
	if len(temporal.starts) != 2 || temporal.starts[1].Trigger != "retry" {
		t.Fatalf("expected 2 starts with retry trigger, got %+v", temporal.starts)
	}
}

func TestTerminalRunCancelAndSignalDoNotCallTemporal(t *testing.T) {
	u, router, temporal := setupTemporalTest(t)
	createAPITask(t, router, u, "api-task")

	createRec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/api-task/runs", map[string]any{
		"runId":              "finished-run",
		"trigger":            "manual",
		"status":             "succeeded",
		"executor":           "api",
		"temporalWorkflowId": "background-task/user/api-task/finished-run",
		"temporalRunId":      "temporal-finished-run",
		"temporalStatus":     "Completed",
	})
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create finished run: want 201, got %d: %s", createRec.Code, createRec.Body.String())
	}

	cancelRec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/api-task/runs/finished-run/cancel", nil)
	if cancelRec.Code != http.StatusAccepted {
		t.Fatalf("cancel finished run: want 202, got %d: %s", cancelRec.Code, cancelRec.Body.String())
	}
	canceled := decodeBody[runView](t, cancelRec)
	if canceled.Status != "succeeded" {
		t.Fatalf("cancel finished run status = %q, want succeeded", canceled.Status)
	}
	if len(temporal.cancels) != 0 {
		t.Fatalf("cancel finished run should not call Temporal, got %+v", temporal.cancels)
	}

	signalRec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/api-task/runs/finished-run/signal", map[string]any{
		"signal": "update_context",
		"payload": map[string]any{
			"qa": "terminal signal",
		},
	})
	if signalRec.Code != http.StatusBadRequest || !strings.Contains(signalRec.Body.String(), "only queued or running runs can be signaled") {
		t.Fatalf("signal finished run: want 400 terminal message, got %d: %s", signalRec.Code, signalRec.Body.String())
	}
	if len(temporal.signals) != 0 {
		t.Fatalf("signal finished run should not call Temporal, got %+v", temporal.signals)
	}
}

// TestCloudRunStartFailureSetsErrorCode verifies a failed Temporal start records
// the granular temporal_start_failed error code on the run row.
func TestCloudRunStartFailureSetsErrorCode(t *testing.T) {
	u, router, temporal := setupTemporalTest(t)
	temporal.startErr = errors.New("temporal unreachable")
	createAPITask(t, router, u, "api-task")

	rec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/api-task/trigger", map[string]any{"trigger": "manual"})
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("trigger with failing temporal: want 502, got %d: %s", rec.Code, rec.Body.String())
	}

	listRec := authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks/api-task/runs", nil)
	runs := decodeBody[runsResponse](t, listRec)
	if len(runs.Runs) != 1 {
		t.Fatalf("want 1 run, got %d", len(runs.Runs))
	}
	got := runs.Runs[0]
	if got.Status != "failed" || got.ErrorCode != backgroundtaskworkflow.ErrCodeTemporalStartFailed {
		t.Fatalf("run status=%q errorCode=%q, want failed/%s", got.Status, got.ErrorCode, backgroundtaskworkflow.ErrCodeTemporalStartFailed)
	}
	if got.ErrorDetails == "" {
		t.Fatalf("expected errorDetails to be populated, got empty")
	}
}

// TestCloudRunFilters verifies the run-list filters used by the global Cloud Runs
// view: trigger, status, and the since/until time range.
func TestCloudRunFilters(t *testing.T) {
	_, u, router := setupTest(t)
	mk := func(name, instructions string) {
		rec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/", map[string]any{"name": name, "instructions": instructions})
		if rec.Code != http.StatusCreated {
			t.Fatalf("create task %s: %d %s", name, rec.Code, rec.Body.String())
		}
	}
	mk("Filter Task", "filterable runs")

	// Two runs with distinct trigger + status.
	for _, r := range []map[string]any{
		{"runId": "run-cron", "trigger": "cron", "status": "succeeded", "executor": "desktop"},
		{"runId": "run-manual", "trigger": "manual", "status": "failed", "executor": "desktop"},
	} {
		rec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/filter-task/runs", r)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create run %v: %d %s", r["runId"], rec.Code, rec.Body.String())
		}
	}

	byTrigger := decodeBody[runsResponse](t, authedJSON(t, router, u, http.MethodGet, "/v1/background-task-runs?trigger=cron", nil))
	if len(byTrigger.Runs) != 1 || byTrigger.Runs[0].RunID != "run-cron" {
		t.Fatalf("trigger=cron filter returned %+v", byTrigger.Runs)
	}
	byStatus := decodeBody[runsResponse](t, authedJSON(t, router, u, http.MethodGet, "/v1/background-task-runs?status=failed", nil))
	if len(byStatus.Runs) != 1 || byStatus.Runs[0].RunID != "run-manual" {
		t.Fatalf("status=failed filter returned %+v", byStatus.Runs)
	}

	// Time-range filters parse and apply (a window far in the future excludes all).
	future := time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339)
	sinceFuture := decodeBody[runsResponse](t, authedJSON(t, router, u, http.MethodGet, "/v1/background-task-runs?since="+future, nil))
	if len(sinceFuture.Runs) != 0 {
		t.Fatalf("since=future should exclude all runs, got %+v", sinceFuture.Runs)
	}

	// Invalid filter values are rejected.
	bad := authedJSON(t, router, u, http.MethodGet, "/v1/background-task-runs?since=not-a-time", nil)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("since=invalid: want 400, got %d", bad.Code)
	}
}

// TestTriggerAPITaskWithoutTemporalReturns503 guards the refactor: a handler
// built via New() with no Temporal configured must answer 503 (not panic on a
// nil run starter) when an api-target task is triggered.
func TestTriggerAPITaskWithoutTemporalReturns503(t *testing.T) {
	_, u, router := setupTest(t) // no SetTemporal
	createAPITask(t, router, u, "api-task")

	rec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/api-task/trigger", map[string]any{"trigger": "manual"})
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("trigger without temporal: want 503, got %d: %s", rec.Code, rec.Body.String())
	}
}

func hasEventType(events []eventView, want string) bool {
	for _, e := range events {
		if e.Type == want {
			return true
		}
	}
	return false
}
